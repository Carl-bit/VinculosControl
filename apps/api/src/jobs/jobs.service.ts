import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { EstadoPaso, Prisma, TipoJob } from '@prisma/client';
import { manifiestoSchema, MODULOS_MVP } from '@vinculos/manifest';
import { hashManifiesto } from '@vinculos/manifest/hash';

import type { OperadorSesion } from '../acceso/acceso.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../comun/prisma.service';
import { ACTIVOS, BLOQUEO, EJECUTABLES, enVentanaRespaldo, estadoTrasPasos, FINALES_PASO, limpiarLog, pasosAReintentar, puedeCancelar, RESERVA_MS, SOBRE_SILO } from './pasos';

const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/** Estados del centro desde los que se puede verificar/aprovisionar (manifiesto aprobado). */
const CON_APROBADO = ['APROBADO', 'APROVISIONANDO', 'ACTIVO', 'ACTIVO_SIN_DOMINIO', 'SUSPENDIDO'];

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ---------- consola ----------

  /**
   * Encola un job. P0 corre aqui: si falla, el job no parte.
   * VERIFICAR (y los que crean silos) nacen de la revision aprobada de un centro;
   * REINICIAR_SILO actua sobre un silo que el agente esta reportando.
   */
  async crear(tipo: TipoJob, destino: { centroId?: number; siloSlug?: string }, op: OperadorSesion, ip: string | null) {
    const defs = EJECUTABLES[tipo];
    if (!defs) throw new UnprocessableEntityException({ mensaje: BLOQUEO[tipo] ?? `${tipo} no se puede encolar` });
    if (SOBRE_SILO.includes(tipo)) return this.crearSobreSilo(tipo, destino.siloSlug ?? '', op, ip);
    const centroId = destino.centroId;
    if (!centroId) throw new UnprocessableEntityException({ mensaje: `${tipo} necesita un centro` });
    const c = await this.prisma.centro.findUnique({ where: { id: centroId } });
    if (!c) throw new NotFoundException();
    if (!CON_APROBADO.includes(c.estado) || !c.revisionAprobada || !c.hashAprobado || !c.slug)
      throw new UnprocessableEntityException({ mensaje: 'El centro necesita un manifiesto aprobado' });
    const activo = await this.prisma.job.findFirst({ where: { centroId, estado: { in: [...ACTIVOS] } }, select: { id: true } });
    if (activo) throw new ConflictException({ mensaje: `Ya hay un job activo para este centro (#${activo.id})` });

    const job = await this.prisma.job.create({
      data: {
        tipo,
        centroId,
        siloSlug: c.slug,
        revision: c.revisionAprobada,
        hashManifiesto: c.hashAprobado,
        creadoPor: op.correo,
        pasos: { create: defs.map((d, i) => ({ orden: i, codigo: d.codigo, nombre: d.nombre, detalle: d.detalle, ejecutor: d.ejecutor })) },
      },
    });
    await this.auditoria.registrar(op.correo, 'job.creado', `job:${job.id}`, `${tipo} ${c.slug} rev ${c.revisionAprobada}${ip ? ` · ${ip}` : ''}`);
    await this.correrPasosControl(job.id);
    return this.detalle(job.id);
  }

  private async crearSobreSilo(tipo: TipoJob, slug: string, op: OperadorSesion, ip: string | null) {
    if (!SLUG.test(slug)) throw new UnprocessableEntityException({ mensaje: 'Slug de silo invalido' });
    const silo = await this.prisma.silo.findUnique({ where: { slug } });
    if (!silo) throw new NotFoundException({ mensaje: `El agente no reporta el silo ${slug}` });
    const activo = await this.prisma.job.findFirst({ where: { siloSlug: slug, estado: { in: [...ACTIVOS] } }, select: { id: true } });
    if (activo) throw new ConflictException({ mensaje: `Ya hay un job activo para este silo (#${activo.id})` });
    const job = await this.prisma.job.create({
      data: {
        tipo,
        siloSlug: slug,
        creadoPor: op.correo,
        pasos: { create: EJECUTABLES[tipo]!.map((d, i) => ({ orden: i, codigo: d.codigo, nombre: d.nombre, detalle: d.detalle, ejecutor: d.ejecutor })) },
      },
    });
    await this.auditoria.registrar(op.correo, 'job.creado', `job:${job.id}`, [tipo, slug, ip].filter(Boolean).join(' · '));
    await this.correrPasosControl(job.id);
    return this.detalle(job.id);
  }

  /** P0 de los jobs sobre un silo: el agente lo reporta (ultimos 10 min) y estamos fuera de la ventana de respaldo. */
  private async p0Silo(slug: string): Promise<{ ok: boolean; log: string[]; error: string | null }> {
    const silo = await this.prisma.silo.findUnique({ where: { slug } });
    const log = [`silo erp-${slug}`];
    if (!silo?.vistoEn || Date.now() - silo.vistoEn.getTime() > 10 * 60_000) return { ok: false, log, error: 'El agente no reporta este silo hace mas de 10 min' };
    log.push(`reportado por el agente hace ${Math.round((Date.now() - silo.vistoEn.getTime()) / 1000)} s`);
    if (enVentanaRespaldo(new Date())) return { ok: false, log, error: 'Ventana de respaldo (01:45 a 02:30 Chile): intenta despues' };
    log.push('fuera de la ventana de respaldo');
    return { ok: true, log, error: null };
  }

  /** Pasos del plano de control (hoy, P0). Idempotente: se puede repetir al reintentar. */
  private async correrPasosControl(jobId: number) {
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: { pasos: { orderBy: { orden: 'asc' } } } });
    for (const p of job.pasos.filter((x) => x.ejecutor === 'control' && x.estado !== 'OK')) {
      await this.prisma.pasoJob.update({ where: { id: p.id }, data: { estado: 'EN_CURSO', inicioEn: new Date(), intentos: { increment: 1 } } });
      const { ok, log, error } = SOBRE_SILO.includes(job.tipo) ? await this.p0Silo(job.siloSlug!) : await this.p0(job.centroId!, job.revision!, job.hashManifiesto!);
      await this.prisma.pasoJob.update({ where: { id: p.id }, data: { estado: ok ? 'OK' : 'FALLIDO', finEn: new Date(), log, error } });
      if (!ok) {
        await this.prisma.job.update({ where: { id: jobId }, data: { estado: 'FALLIDO', error, terminadoEn: new Date() } });
        await this.auditoria.registrar('control', 'job.fallido', `job:${jobId}`, `${p.codigo}: ${error}`);
        return;
      }
    }
  }

  /** P0 sobre la revision aprobada: schema v1 (incluye dependencias), modulos del MVP y hash. */
  private async p0(centroId: number, revision: number, hash: string): Promise<{ ok: boolean; log: string[]; error: string | null }> {
    const rev = await this.prisma.revisionManifiesto.findUnique({ where: { centroId_numero: { centroId, numero: revision } } });
    const log = [`manifiesto rev ${revision} sha ${hash.slice(0, 12)}`];
    if (!rev) return { ok: false, log, error: 'No existe la revision aprobada' };
    if (hashManifiesto(rev.contenido) !== hash) return { ok: false, log, error: 'El hash de la revision no coincide con el aprobado' };
    log.push('hash coincide');
    const r = manifiestoSchema.safeParse(rev.contenido);
    if (!r.success) return { ok: false, log, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
    log.push('schema v1 valido', `dependencias ok (${r.data.modulos.join(', ') || 'solo nucleo'})`);
    const fuera = r.data.modulos.filter((m) => !(MODULOS_MVP as readonly string[]).includes(m));
    if (fuera.length) return { ok: false, log, error: `Modulos fuera del MVP: ${fuera.join(', ')}` };
    log.push(`dominio ${r.data.dominio.valor}`, `version ${'canal' in r.data.version ? `canal ${r.data.version.canal}` : r.data.version.fija}`);
    return { ok: true, log, error: null };
  }

  listar() {
    return this.prisma.job.findMany({
      orderBy: { creadoEn: 'desc' },
      take: 100,
      include: { pasos: { select: { codigo: true, estado: true }, orderBy: { orden: 'asc' } } },
    });
  }

  async detalle(id: number) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: { pasos: { orderBy: { orden: 'asc' } } } });
    if (!job) throw new NotFoundException();
    const [centro, agente] = await Promise.all([
      job.centroId ? this.prisma.centro.findUnique({ where: { id: job.centroId }, select: { id: true, nombre: true, slug: true, estado: true } }) : null,
      job.agenteId ? this.prisma.agente.findUnique({ where: { id: job.agenteId }, select: { nombre: true } }) : null,
    ]);
    return { ...job, centro, agente: agente?.nombre ?? null, puedeCancelar: puedeCancelar(job.estado) };
  }

  async reintentar(id: number, op: OperadorSesion, ip: string | null) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: { pasos: true } });
    if (!job) throw new NotFoundException();
    if (job.estado !== 'FALLIDO') throw new UnprocessableEntityException({ mensaje: 'Solo se reintenta un job FALLIDO' });
    const codigos = pasosAReintentar(job.pasos);
    await this.prisma.$transaction([
      this.prisma.pasoJob.updateMany({ where: { jobId: id, codigo: { in: codigos } }, data: { estado: 'PENDIENTE', error: null } }),
      this.prisma.job.update({ where: { id }, data: { estado: 'PENDIENTE', error: null, terminadoEn: null, agenteId: null, reservaHasta: null } }),
    ]);
    await this.auditoria.registrar(op.correo, 'job.reintento', `job:${id}`, `desde ${codigos[0] ?? '-'}${ip ? ` · ${ip}` : ''}`);
    await this.correrPasosControl(id);
    return this.detalle(id);
  }

  /** VERIFICAR no crea nada: cancelar no tiene que deshacer. Los jobs que crean cosas deshacen solo lo propio. */
  async cancelar(id: number, op: OperadorSesion, ip: string | null) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException();
    if (!puedeCancelar(job.estado)) throw new UnprocessableEntityException({ mensaje: `Un job ${job.estado} no se cancela` });
    await this.prisma.job.update({ where: { id }, data: { estado: 'CANCELADO', terminadoEn: new Date() } });
    await this.auditoria.registrar(op.correo, 'job.cancelado', `job:${id}`, ip);
  }

  // ---------- agente ----------

  /**
   * El agente reclama el job mas antiguo de los tipos que sabe ejecutar:
   * PENDIENTE, o EN_CURSO con la reserva vencida (el agente anterior murio).
   * FOR UPDATE SKIP LOCKED: dos agentes nunca toman el mismo.
   */
  async reclamar(agenteId: number, tipos: TipoJob[]) {
    const permitidos = tipos.filter((t) => EJECUTABLES[t]);
    if (!permitidos.length) return null;
    const ahora = new Date();
    const id = await this.prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM jobs
        WHERE tipo::text = ANY(${permitidos}::text[])
          AND (estado = 'PENDIENTE' OR (estado = 'EN_CURSO' AND reserva_hasta < now()))
        ORDER BY creado_en
        FOR UPDATE SKIP LOCKED
        LIMIT 1`;
      if (!filas.length) return null;
      await tx.job.update({
        where: { id: filas[0].id },
        data: { estado: 'EN_CURSO', agenteId, reclamadoEn: ahora, reservaHasta: new Date(ahora.getTime() + RESERVA_MS), intentos: { increment: 1 } },
      });
      // Un paso que quedo EN_CURSO con el agente anterior se repite (los pasos son idempotentes).
      await tx.pasoJob.updateMany({ where: { jobId: filas[0].id, estado: 'EN_CURSO' }, data: { estado: 'PENDIENTE' } });
      return filas[0].id;
    });
    if (id === null) return null;
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id }, include: { pasos: { orderBy: { orden: 'asc' } } } });
    const rev =
      job.centroId && job.revision
        ? await this.prisma.revisionManifiesto.findUnique({ where: { centroId_numero: { centroId: job.centroId, numero: job.revision } }, select: { contenido: true } })
        : null;
    await this.auditoria.registrar(`agente:${agenteId}`, 'job.reclamado', `job:${id}`, `${job.tipo} ${job.siloSlug}`);
    return {
      id: job.id,
      tipo: job.tipo,
      slug: job.siloSlug,
      revision: job.revision,
      hashManifiesto: job.hashManifiesto,
      manifiesto: rev?.contenido ?? null,
      pasos: job.pasos.filter((p) => p.ejecutor === 'agente').map((p) => ({ codigo: p.codigo, estado: p.estado })),
    };
  }

  /** Reporte de un paso. Renueva la reserva. Si el job ya no es de este agente o se cancelo: 409 y el agente se detiene. */
  async reportarPaso(agenteId: number, jobId: number, codigo: string, estado: EstadoPaso, lineas: unknown, error?: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { pasos: true } });
    if (!job) throw new NotFoundException();
    if (job.agenteId !== agenteId) throw new ForbiddenException();
    if (job.estado !== 'EN_CURSO') throw new ConflictException({ mensaje: `Job ${job.estado}`, detener: true });
    const paso = job.pasos.find((p) => p.codigo === codigo && p.ejecutor === 'agente');
    if (!paso) throw new NotFoundException({ mensaje: `Paso ${codigo} no es del agente` });
    const ahora = new Date();
    const final = FINALES_PASO.includes(estado);
    const datos: Prisma.PasoJobUpdateInput =
      estado === 'EN_CURSO'
        ? { estado, inicioEn: ahora, finEn: null, intentos: { increment: 1 }, error: null }
        : { estado, finEn: ahora, log: limpiarLog(lineas), error: error?.slice(0, 500) ?? null };
    await this.prisma.$transaction([
      this.prisma.pasoJob.update({ where: { id: paso.id }, data: datos }),
      this.prisma.job.update({ where: { id: jobId }, data: { reservaHasta: new Date(ahora.getTime() + RESERVA_MS) } }),
    ]);
    if (!final) return { seguir: true };
    const pasos = job.pasos.map((p) => (p.id === paso.id ? { ...p, estado } : p));
    const nuevo = estadoTrasPasos(pasos);
    if (nuevo !== 'EN_CURSO') {
      await this.prisma.job.update({ where: { id: jobId }, data: { estado: nuevo, terminadoEn: ahora, error: nuevo === 'FALLIDO' ? `${codigo}: ${error ?? 'fallo'}`.slice(0, 500) : null } });
      await this.auditoria.registrar(`agente:${agenteId}`, nuevo === 'OK' ? 'job.ok' : 'job.fallido', `job:${jobId}`, nuevo === 'FALLIDO' ? `${codigo}: ${error ?? ''}` : job.siloSlug);
    }
    return { seguir: nuevo === 'EN_CURSO' };
  }

  contarActivos() {
    return this.prisma.job.count({ where: { estado: { in: [...ACTIVOS] } } });
  }
}
