import { ConflictException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { type EstadoCentro, type Job, Prisma } from '@prisma/client';
import { hashManifiesto } from '@vinculos/manifest/hash';

import { CorreoService } from '../acceso/correo.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../comun/prisma.service';
import { CHECKLIST } from './reglas';

/**
 * Pasos de una salida que cierran algo y que se disparan desde dos lados: la
 * consola (a mano) y el final de un job del ejecutor (DETENER_SILO,
 * REANUDAR_SILO, ELIMINAR). No depende de JobsService: JobsService lo llama al
 * terminar un job, y SalidasService lo usa desde la consola.
 */
@Injectable()
export class SalidasCierre {
  private readonly log = new Logger(SalidasCierre.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly correo: CorreoService,
  ) {}

  /** Cambio de estado optimista (si otro lo movio antes, 409) + transicion + cambios del paso, en una transaccion. */
  async transitar(id: number, desde: EstadoCentro, hacia: EstadoCentro, actor: string, motivo: string, cambios: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.centro.updateMany({ where: { id, estado: desde }, data: { estado: hacia } });
      if (r.count !== 1) throw new ConflictException({ mensaje: 'El centro cambio de estado mientras tanto. Recarga.' });
      await tx.transicionCentro.create({ data: { centroId: id, desde, hacia, actor, motivo: motivo.slice(0, 300) } });
      await cambios(tx);
    });
  }

  /** S6: silo detenido (por el job DETENER_SILO o confirmado a mano). EXPORTADO -> GRACIA; el silo sale del monitoreo. */
  async siloDetenido(salidaId: number, actor: string, jobId: number | null) {
    const s = await this.prisma.salida.findUniqueOrThrow({ where: { id: salidaId }, include: { centro: { select: { estado: true } } } });
    if (s.siloDetenidoEn) return;
    if (s.centro.estado !== 'EXPORTADO') throw new UnprocessableEntityException({ mensaje: `El silo se detiene con el centro EXPORTADO (esta en ${s.centro.estado})` });
    await this.transitar(s.centroId, 'EXPORTADO', 'GRACIA', actor, jobId ? `silo detenido por job:${jobId}` : 'silo detenido', async (tx) => {
      await tx.salida.update({ where: { id: salidaId }, data: { siloDetenidoEn: new Date(), siloDetenidoPor: actor, detencionJobId: jobId } });
      await tx.silo.updateMany({ where: { slug: s.siloSlug, adoptado: true }, data: { adoptado: false, adoptadoEn: null } });
    });
    await this.auditoria.registrar(actor, 'salida.silo_detenido', `centro:${s.centroId}`, `${s.siloSlug} · fuera del monitoreo${jobId ? ` · job:${jobId}` : ''}`);
  }

  /**
   * Reversion: el centro vuelve al estado previo a la salida, el silo vuelve al
   * monitoreo y la salida queda cerrada como revertida con su acta (hash) y
   * copia por correo. Idempotente.
   */
  async completarReversion(salidaId: number, actor: string, jobId: number | null) {
    const s = await this.prisma.salida.findUniqueOrThrow({ where: { id: salidaId }, include: { centro: { select: { nombre: true, estado: true } } } });
    if (s.revertidaEn) return;
    if (!s.reversionPedidaEn) throw new UnprocessableEntityException({ mensaje: 'No hay una reversion pedida' });
    const ahora = new Date();
    const acta = {
      tipo: 'acta_reversion',
      centro: s.centro.nombre,
      silo: s.siloSlug,
      salidaIniciada: s.iniciadaEn.toISOString(),
      fechaCorte: s.fechaCorte.toISOString().slice(0, 10),
      etapa: s.centro.estado,
      vuelveA: s.desde,
      solicitud: { en: s.reversionSolicitudEn?.toISOString() ?? null, medio: s.reversionMedio, referencia: s.reversionRef },
      motivo: s.reversionMotivo,
      siloReanudado: s.siloDetenidoEn ? (jobId ? `job:${jobId}` : 'a mano') : 'no estaba detenido',
      revertidaEn: ahora.toISOString(),
      revertidaPor: actor,
      texto: `La salida de ${s.centro.nombre} se revirtio el dia ${ahora.toISOString().slice(0, 10)}: el servicio continua sin perdida de datos`,
    };
    const hash = hashManifiesto(acta);
    await this.transitar(s.centroId, s.centro.estado, s.desde, actor, `salida revertida · acta ${hash.slice(0, 12)}`, async (tx) => {
      await tx.salida.update({ where: { id: salidaId }, data: { revertidaEn: ahora, abierta: null, actaReversion: acta as Prisma.InputJsonValue, actaReversionHash: hash } });
      if (s.siloDetenidoEn) await tx.silo.updateMany({ where: { slug: s.siloSlug }, data: { adoptado: true, adoptadoEn: ahora } });
    });
    await this.auditoria.registrar(actor, 'salida.revertida', `centro:${s.centroId}`, `${s.siloSlug} · vuelve a ${s.desde} · acta ${hash.slice(0, 12)}`);
    await this.enviarActa(salidaId, 'reversion', actor);
  }

  /** ELIMINAR terminado OK: queda como evidencia de la salida (el acta S7 la registra el operador). */
  async eliminacionHecha(salidaId: number, jobId: number) {
    await this.prisma.salida.update({ where: { id: salidaId }, data: { eliminacionJobId: jobId } });
    const s = await this.prisma.salida.findUniqueOrThrow({ where: { id: salidaId }, select: { centroId: true, siloSlug: true } });
    await this.auditoria.registrar(`job:${jobId}`, 'salida.silo_eliminado', `centro:${s.centroId}`, `${s.siloSlug}: contenedores, volumenes, redes y respaldos del host borrados por el ejecutor`);
  }

  /** Lo llama JobsService cuando un job termina OK. */
  async alTerminarJob(job: Pick<Job, 'id' | 'tipo' | 'centroId'>) {
    if (!job.centroId || !['DETENER_SILO', 'REANUDAR_SILO', 'ELIMINAR'].includes(job.tipo)) return;
    const s = await this.prisma.salida.findFirst({ where: { centroId: job.centroId, abierta: true }, select: { id: true } });
    if (!s) return;
    const actor = `job:${job.id}`;
    if (job.tipo === 'DETENER_SILO') await this.siloDetenido(s.id, actor, job.id);
    else if (job.tipo === 'REANUDAR_SILO') await this.completarReversion(s.id, actor, job.id);
    else await this.eliminacionHecha(s.id, job.id);
  }

  /**
   * Copia de un acta (eliminacion o reversion) al responsable de datos del
   * manifiesto aprobado (si no hay, al contacto del centro). Si el correo falla
   * no deshace nada: queda en la auditoria y se reenvia desde la consola.
   */
  async enviarActa(salidaId: number, tipo: 'eliminacion' | 'reversion', actor: string): Promise<{ enviada: boolean; para: string }> {
    const s = await this.prisma.salida.findUniqueOrThrow({ where: { id: salidaId }, include: { centro: true } });
    const acta = (tipo === 'eliminacion' ? s.actaEliminacion : s.actaReversion) as Record<string, unknown> | null;
    const hash = tipo === 'eliminacion' ? s.actaEliminacionHash : s.actaReversionHash;
    if (!acta || !hash) throw new UnprocessableEntityException({ mensaje: `El acta de ${tipo} aun no esta registrada` });
    const rev = s.centro.revisionAprobada
      ? await this.prisma.revisionManifiesto.findUnique({ where: { centroId_numero: { centroId: s.centroId, numero: s.centro.revisionAprobada } }, select: { contenido: true } })
      : null;
    const para = (rev?.contenido as { centro?: { responsable_datos?: { correo?: string } } } | null)?.centro?.responsable_datos?.correo ?? s.centro.contactoCorreo;
    try {
      if (tipo === 'eliminacion') {
        const a = acta as { centro: string; silo: string; eliminadoEn: string; exporteHuella: string | null; actaRecepcion: string | null; nota: string | null };
        await this.correo.enviarActaEliminacion(para, {
          centro: a.centro,
          silo: a.silo,
          fecha: a.eliminadoEn.slice(0, 10),
          items: CHECKLIST.map((i) => i.l.replace('<slug>', a.silo)),
          exporteHuella: a.exporteHuella,
          actaRecepcion: a.actaRecepcion,
          nota: a.nota,
          hash,
        });
      } else {
        const a = acta as { centro: string; silo: string; texto: string; vuelveA: string; revertidaEn: string };
        await this.correo.enviarActaReversion(para, { centro: a.centro, silo: a.silo, texto: a.texto, fecha: a.revertidaEn.slice(0, 10), hash });
      }
    } catch (e) {
      this.log.warn(`acta de ${tipo} de la salida ${salidaId} no enviada: ${e instanceof Error ? e.message : String(e)}`);
      await this.auditoria.registrar(actor, 'salida.acta_no_enviada', `salida:${salidaId}`, `${tipo} · ${para}`);
      return { enviada: false, para };
    }
    await this.auditoria.registrar(actor, 'salida.acta_enviada', `salida:${salidaId}`, `${tipo} · ${para}`);
    return { enviada: true, para };
  }
}
