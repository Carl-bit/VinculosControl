import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { manifiestoSchema } from '@vinculos/manifest';

import type { OperadorSesion } from '../acceso/acceso.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { guardarRevision } from '../centros/borrador';
import { PrismaService } from '../comun/prisma.service';
import { ACTIVOS } from '../jobs/pasos';
import { JobsService } from '../jobs/jobs.service';
import { type Decision, type EstadoSolicitud, fusionar, porEntregar, type Registrada, revertirRechazo, siguienteEntrega, transicionValida } from './reglas';

export interface SolicitudDelSilo {
  id: string;
  modulo: string;
  accion: string;
  pedidaPorRol: string;
  pedidaEn: string;
  estado: EstadoSolicitud;
}

/**
 * Tarea 31 (R2/R3). El agente trae lo que el silo expone en R2; el operador
 * decide en la consola; el agente devuelve la decision con R3. Aplicar el
 * cambio de modulos es del operador: hoy a mano (ERP_REGLAS_Y_DESPLIEGUE.md,
 * seccion 5); con R4, un job `reconfigurar` desde una revision del manifiesto.
 */
@Injectable()
export class SolicitudesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly jobs: JobsService,
  ) {}

  /** Agente: guarda lo que reporto el silo y devuelve las decisiones por entregar. */
  async sincronizar(slug: string, solicitudes: SolicitudDelSilo[], fallidas: { id: string; error: string }[]) {
    if (!(await this.prisma.silo.findUnique({ where: { slug }, select: { slug: true } }))) {
      throw new NotFoundException(`silo ${slug} desconocido (falta su reporte)`);
    }
    const ahora = new Date();
    const existentes = new Map(
      (await this.prisma.solicitudModulo.findMany({ where: { siloSlug: slug, id: { in: solicitudes.map((s) => s.id) } } })).map((s) => [s.id, s]),
    );
    const tras = new Map<string, Registrada>();
    const revertidas: { id: string; modulo: string; accion: string; error: string }[] = [];
    await this.prisma.$transaction([
      ...solicitudes.map((s) => {
        const previa = existentes.get(s.id);
        const r = fusionar(previa ? { estado: previa.estado as EstadoSolicitud, estadoSilo: previa.estadoSilo as EstadoSolicitud } : null, s.estado);
        tras.set(s.id, r);
        const base = { modulo: s.modulo, accion: s.accion, pedidaPorRol: s.pedidaPorRol, pedidaEn: new Date(s.pedidaEn), vistaEn: ahora };
        // El error de entrega se limpia cuando el silo confirma un estado nuevo
        // (no en cada ciclo: un rechazo revertido debe seguir a la vista).
        const confirmoNuevo = !!previa && previa.estadoSilo !== s.estado;
        return this.prisma.solicitudModulo.upsert({
          where: { siloSlug_id: { siloSlug: slug, id: s.id } },
          create: { siloSlug: slug, id: s.id, ...base, ...r },
          update: { ...base, ...r, ...(confirmoNuevo ? { errorEntrega: null } : {}) },
        });
      }),
      ...fallidas.map((f) => {
        const r = tras.get(f.id);
        const vuelve = r ? revertirRechazo(r, f.error) : null;
        if (vuelve) {
          const s = solicitudes.find((x) => x.id === f.id)!;
          revertidas.push({ id: f.id, modulo: s.modulo, accion: s.accion, error: f.error });
          tras.set(f.id, { estado: vuelve, estadoSilo: r!.estadoSilo });
        }
        return this.prisma.solicitudModulo.updateMany({
          where: { siloSlug: slug, id: f.id },
          data: vuelve ? { estado: vuelve, errorEntrega: `El silo rechazo APLICADA: ${f.error}`.slice(0, 300) } : { errorEntrega: f.error.slice(0, 300) },
        });
      }),
    ]);
    for (const v of revertidas) {
      await this.auditoria.registrar('control', 'modulo.solicitud_revertida', `${slug}/${v.modulo}`, `${v.accion} APLICADA -> APROBADA: ${v.error.slice(0, 200)}`);
    }
    const abiertas = await this.prisma.solicitudModulo.findMany({ where: { siloSlug: slug, estado: { not: 'PENDIENTE' } } });
    return {
      respuestas: abiertas
        .filter((s) => porEntregar({ estado: s.estado as EstadoSolicitud, estadoSilo: s.estadoSilo as EstadoSolicitud }))
        .map((s) => ({ id: s.id, estado: siguienteEntrega({ estado: s.estado as EstadoSolicitud, estadoSilo: s.estadoSilo as EstadoSolicitud }), respuesta: s.respuesta })),
    };
  }

  /**
   * Bandeja de la consola. Cada fila dice si el silo aplica los cambios solo
   * (`automatica`: hay centro con manifiesto aprobado -> RECONFIGURAR) y si ya
   * hay un job activo sobre ese silo.
   */
  async listar(silo?: string) {
    const filas = await this.prisma.solicitudModulo.findMany({
      where: silo ? { siloSlug: silo } : {},
      orderBy: [{ pedidaEn: 'desc' }],
      take: 200,
    });
    const slugs = [...new Set(filas.map((f) => f.siloSlug))];
    const centros = await this.prisma.centro.findMany({ where: { slug: { in: slugs } }, select: { slug: true, revisionAprobada: true, hashAprobado: true } });
    const auto = new Set(centros.filter((c) => c.revisionAprobada && c.hashAprobado).map((c) => c.slug));
    const jobs = await this.prisma.job.findMany({ where: { siloSlug: { in: slugs }, estado: { in: [...ACTIVOS] } }, select: { id: true, siloSlug: true } });
    const activo = new Map(jobs.map((j) => [j.siloSlug, j.id]));
    return filas.map((f) => ({ ...f, automatica: auto.has(f.siloSlug), jobActivo: activo.get(f.siloSlug) ?? null }));
  }

  /**
   * Consola: aplicar una solicitud APROBADA con RECONFIGURAR (R4). Sirve para
   * aprobaciones que quedaron sin job (el centro se aprobo despues, o el job
   * fallo o se cancelo). Idempotente: si la revision aprobada ya refleja el
   * cambio, solo encola el job.
   */
  async aplicar(slug: string, id: string, o: OperadorSesion) {
    const s = await this.prisma.solicitudModulo.findUnique({ where: { siloSlug_id: { siloSlug: slug, id } } });
    if (!s) throw new NotFoundException('solicitud inexistente');
    if (s.estado !== 'APROBADA' || s.estadoSilo !== 'APROBADA') {
      throw new ConflictException({ mensaje: `Solo se aplica una solicitud APROBADA y confirmada por el silo (esta en ${s.estado}, el silo dice ${s.estadoSilo})` });
    }
    const r = await this.reconfigurar(slug, s.modulo, s.accion, o);
    if (r.jobId === null) throw new UnprocessableEntityException({ mensaje: r.motivo });
    return { reconfigurar: r };
  }

  /** Consola: decision del operador. Valida la transicion; la entrega la hace el agente (R3). */
  async decidir(slug: string, id: string, estado: Decision, respuesta: string | undefined, o: OperadorSesion) {
    const s = await this.prisma.solicitudModulo.findUnique({ where: { siloSlug_id: { siloSlug: slug, id } } });
    if (!s) throw new NotFoundException('solicitud inexistente');
    if (s.estado === estado) return s;
    if (!transicionValida(s.estado as EstadoSolicitud, estado)) {
      throw new ConflictException({ mensaje: `No se puede pasar de ${s.estado} a ${estado}` });
    }
    if (s.estadoSilo !== s.estado) {
      throw new BadRequestException({ mensaje: `La decision anterior (${s.estado}) aun no llega al silo: espera el siguiente ciclo del agente` });
    }
    if (estado === 'APLICADA') {
      const centro = await this.prisma.centro.findFirst({ where: { slug }, select: { revisionAprobada: true, hashAprobado: true } });
      if (centro?.revisionAprobada && centro.hashAprobado) {
        throw new ConflictException({ mensaje: 'Este silo tiene manifiesto aprobado: la solicitud la marca APLICADA el job RECONFIGURAR. Usa "Aplicar con RECONFIGURAR".' });
      }
    }
    const texto = respuesta?.trim() || null;
    const r = await this.prisma.solicitudModulo.update({
      where: { siloSlug_id: { siloSlug: slug, id } },
      data: { estado, respuesta: texto, decididaPor: o.correo, decididaEn: new Date(), errorEntrega: null },
    });
    await this.auditoria.registrar(o.correo, 'modulo.solicitud_decidida', `${slug}/${s.modulo}`, `${s.accion} ${s.estado} -> ${estado}`);
    if (estado !== 'APROBADA') return r;
    return { ...r, reconfigurar: await this.reconfigurar(slug, s.modulo, s.accion, o) };
  }

  /**
   * Aprobar = nueva revision aprobada del manifiesto con el cambio de modulo +
   * job RECONFIGURAR (R4). Al terminar OK, el job marca la solicitud APLICADA.
   * Sin centro con manifiesto aprobado para ese silo (por ejemplo, el silo de
   * desarrollo), queda el camino manual y se informa por que.
   */
  private async reconfigurar(slug: string, modulo: string, accion: string, o: OperadorSesion): Promise<{ jobId: number | null; motivo: string }> {
    const centro = await this.prisma.centro.findFirst({ where: { slug } });
    if (!centro?.revisionAprobada || !centro.hashAprobado) {
      return { jobId: null, motivo: 'El silo no tiene un centro con manifiesto aprobado en la consola: aplicar el cambio a mano y marcar aplicada' };
    }
    const rev = await this.prisma.revisionManifiesto.findUnique({ where: { centroId_numero: { centroId: centro.id, numero: centro.revisionAprobada } } });
    const actual = (rev?.contenido ?? {}) as { modulos?: string[] };
    const modulos = new Set(actual.modulos ?? []);
    if (accion === 'ACTIVAR') modulos.add(modulo);
    else modulos.delete(modulo);
    const yaRefleja = (actual.modulos ?? []).includes(modulo) === (accion === 'ACTIVAR');
    let r: { numero: number };
    if (yaRefleja) {
      // Reintento: la revision aprobada ya tiene el cambio; no se crea otra.
      r = { numero: centro.revisionAprobada };
    } else {
      const nuevo = { ...actual, modulos: [...modulos].sort() };
      const p = manifiestoSchema.safeParse(nuevo);
      if (!p.success) return { jobId: null, motivo: `La revision nueva no pasa el schema: ${p.error.issues.map((i) => i.message).join('; ')}` };
      r = await this.prisma.$transaction(async (tx) => {
        const g = await guardarRevision(tx, centro.id, 3, p.data, o.correo);
        await tx.centro.update({ where: { id: centro.id }, data: { revisionAprobada: g.numero, hashAprobado: g.hash } });
        return g;
      });
      await this.auditoria.registrar(o.correo, 'manifiesto.revision_por_solicitud', `centro:${centro.id}`, `rev ${r.numero} ${accion} ${modulo}`);
    }
    try {
      const job = await this.jobs.crear('RECONFIGURAR', { centroId: centro.id }, o, null);
      return { jobId: job.id, motivo: `rev ${r.numero} aprobada y job RECONFIGURAR #${job.id} encolado` };
    } catch (e) {
      const mensaje = e instanceof HttpException ? JSON.stringify(e.getResponse()) : String(e);
      return { jobId: null, motivo: `rev ${r.numero} aprobada, pero el job no se encolo: ${mensaje.slice(0, 200)}` };
    }
  }
}
