import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { EstadoPaso, Job, Prisma, Salida, TipoJob } from '@prisma/client';
import { manifiestoSchema, MODULOS_MVP } from '@vinculos/manifest';
import { hashManifiesto } from '@vinculos/manifest/hash';

import type { OperadorSesion } from '../acceso/acceso.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../comun/prisma.service';
import { SalidasCierre } from '../salidas/cierre.service';
import { bloqueosEliminar } from '../salidas/reglas';
import { AprovisionarService, type DatosP2, PARA_APROVISIONAR } from './aprovisionar.service';
import {
  ACTIVOS,
  anterioresListos,
  BLOQUEO,
  DE_SALIDA,
  EJECUTABLES,
  enVentanaRespaldo,
  ESPERAS,
  estadoTrasPasos,
  FINALES_PASO,
  limpiarLog,
  pasosAReintentar,
  puedeCancelar,
  RESERVA_MS,
  siguientePaso,
  SOBRE_SILO,
} from './pasos';

const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/** Estados del centro desde los que se puede verificar/aprovisionar (manifiesto aprobado). */
const CON_APROBADO = ['APROBADO', 'APROVISIONANDO', 'ACTIVO', 'ACTIVO_SIN_DOMINIO', 'SUSPENDIDO'];

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly cierre: SalidasCierre,
    private readonly aprov: AprovisionarService,
  ) {}

  // ---------- consola ----------

  /**
   * Jobs de una salida (DETENER_SILO, REANUDAR_SILO, ELIMINAR): los encola
   * SalidasService. ELIMINAR lleva el hash del acta de recepcion, que el
   * ejecutor compara con el consentimiento local bajas/<slug>.
   */
  async crearDeSalida(tipo: TipoJob, s: Salida, op: OperadorSesion, ip: string | null) {
    const defs = EJECUTABLES[tipo];
    if (!defs || !DE_SALIDA.includes(tipo)) throw new UnprocessableEntityException({ mensaje: `${tipo} no nace de una salida` });
    const activo = await this.prisma.job.findFirst({ where: { OR: [{ centroId: s.centroId }, { siloSlug: s.siloSlug }], estado: { in: [...ACTIVOS] } }, select: { id: true } });
    if (activo) throw new ConflictException({ mensaje: `Ya hay un job activo para este silo (#${activo.id})` });
    const job = await this.prisma.job.create({
      data: {
        tipo,
        centroId: s.centroId,
        siloSlug: s.siloSlug,
        referencia: tipo === 'ELIMINAR' ? s.actaRecepcionHash : null,
        creadoPor: op.correo,
        pasos: { create: defs.map((d, i) => ({ orden: i, codigo: d.codigo, nombre: d.nombre, detalle: d.detalle, ejecutor: d.ejecutor })) },
      },
    });
    await this.auditoria.registrar(op.correo, 'job.creado', `job:${job.id}`, [tipo, s.siloSlug, `salida:${s.id}`, ip].filter(Boolean).join(' · '));
    await this.correrPasosControl(job.id);
    return this.detalle(job.id);
  }

  /** P0 de los jobs de una salida: se lee el estado vivo de la salida abierta (al reintentar tambien). */
  private async p0Salida(tipo: TipoJob, centroId: number, slug: string, referencia: string | null): Promise<{ ok: boolean; log: string[]; error: string | null }> {
    const s = await this.prisma.salida.findFirst({ where: { centroId, abierta: true }, include: { centro: { select: { estado: true } } } });
    const log = [`salida de erp-${slug}`];
    const no = (error: string) => ({ ok: false, log, error });
    if (!s) return no('El centro no tiene una salida abierta');
    log.push(`centro ${s.centro.estado}`);
    if (tipo === 'DETENER_SILO') {
      if (s.reversionPedidaEn) return no('Hay una reversion pedida');
      if (s.centro.estado !== 'EXPORTADO' && !(s.centro.estado === 'GRACIA' && s.siloDetenidoEn)) return no('El silo se detiene con el acta de recepcion registrada (EXPORTADO)');
    } else if (tipo === 'REANUDAR_SILO') {
      if (!s.reversionPedidaEn || s.revertidaEn) return no('No hay una reversion pedida');
      if (s.eliminacionJobId) return no('El silo ya se elimino');
    } else {
      const bloqueos = bloqueosEliminar(s, s.centro.estado, new Date());
      if (bloqueos.length) return no(bloqueos.join('. '));
      if (!referencia || referencia !== s.actaRecepcionHash) return no('El hash del job no es el del acta de recepcion');
      log.push(`acta de recepcion ${referencia.slice(0, 12)}`);
    }
    const silo = await this.p0Silo(slug);
    return { ok: silo.ok, log: [...log, ...silo.log.slice(1)], error: silo.error };
  }

  /**
   * Encola un job. P0 corre aqui: si falla, el job no parte.
   * VERIFICAR (y los que crean silos) nacen de la revision aprobada de un centro;
   * REINICIAR_SILO actua sobre un silo que el agente esta reportando.
   */
  async crear(tipo: TipoJob, destino: { centroId?: number; siloSlug?: string }, op: OperadorSesion, ip: string | null) {
    const defs = EJECUTABLES[tipo];
    if (!defs) throw new UnprocessableEntityException({ mensaje: BLOQUEO[tipo] ?? `${tipo} no se puede encolar` });
    if (DE_SALIDA.includes(tipo)) throw new UnprocessableEntityException({ mensaje: `${tipo} se encola desde Salidas` });
    if (SOBRE_SILO.includes(tipo)) return this.crearSobreSilo(tipo, destino.siloSlug ?? '', op, ip);
    const centroId = destino.centroId;
    if (!centroId) throw new UnprocessableEntityException({ mensaje: `${tipo} necesita un centro` });
    const c = await this.prisma.centro.findUnique({ where: { id: centroId } });
    if (!c) throw new NotFoundException();
    if (!CON_APROBADO.includes(c.estado) || !c.revisionAprobada || !c.hashAprobado || !c.slug)
      throw new UnprocessableEntityException({ mensaje: 'El centro necesita un manifiesto aprobado' });
    if (tipo === 'APROVISIONAR' && !PARA_APROVISIONAR.includes(c.estado))
      throw new UnprocessableEntityException({ mensaje: `Un centro ${c.estado} no se aprovisiona (solo APROBADO)` });
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
      const { ok, log, error } =
        job.tipo === 'APROVISIONAR'
          ? await this.pasoAprovisionar(p.codigo, job)
          : DE_SALIDA.includes(job.tipo)
            ? await this.p0Salida(job.tipo, job.centroId!, job.siloSlug!, job.referencia)
            : SOBRE_SILO.includes(job.tipo)
              ? await this.p0Silo(job.siloSlug!)
              : await this.p0Manifiesto(job.tipo, job.centroId!, job.revision!, job.hashManifiesto!, job.siloSlug!);
      await this.prisma.pasoJob.update({ where: { id: p.id }, data: { estado: ok ? 'OK' : 'FALLIDO', finEn: new Date(), log, error } });
      if (!ok) {
        await this.prisma.job.update({ where: { id: jobId }, data: { estado: 'FALLIDO', error, terminadoEn: new Date() } });
        await this.auditoria.registrar('control', 'job.fallido', `job:${jobId}`, `${p.codigo}: ${error}`);
        return;
      }
    }
  }

  /** Pasos del plano de control de APROVISIONAR: P0 (manifiesto + reglas de aprovisionar) y P1 (reservar). */
  private async pasoAprovisionar(codigo: string, job: Job) {
    const rev = await this.prisma.revisionManifiesto.findUnique({ where: { centroId_numero: { centroId: job.centroId!, numero: job.revision! } } });
    if (codigo === 'P1') return this.aprov.p1(job, rev?.contenido);
    const m = await this.p0(job.centroId!, job.revision!, job.hashManifiesto!);
    if (!m.ok) return m;
    const a = await this.aprov.p0(job, rev?.contenido);
    return { ok: a.ok, log: [...m.log, ...a.log], error: a.error };
  }

  /** P0 de los jobs que nacen del manifiesto. RECONFIGURAR actua sobre un silo vivo: ademas, el silo reportado. */
  private async p0Manifiesto(tipo: TipoJob, centroId: number, revision: number, hash: string, slug: string) {
    const m = await this.p0(centroId, revision, hash);
    if (!m.ok || tipo !== 'RECONFIGURAR') return m;
    const s = await this.p0Silo(slug);
    return { ok: s.ok, log: [...m.log, ...s.log], error: s.error };
  }

  /**
   * RECONFIGURAR terminado OK: las solicitudes de modulo APROBADAS del silo que
   * la revision aplicada ya refleja pasan a APLICADA (el agente lo entrega al
   * silo con R3 en su siguiente ciclo).
   */
  private async cerrarSolicitudes(jobId: number) {
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    if (job.tipo !== 'RECONFIGURAR' || !job.centroId || !job.revision || !job.siloSlug) return;
    const rev = await this.prisma.revisionManifiesto.findUnique({ where: { centroId_numero: { centroId: job.centroId, numero: job.revision } } });
    const modulos = ((rev?.contenido as { modulos?: string[] } | null)?.modulos ?? []) as string[];
    const aprobadas = await this.prisma.solicitudModulo.findMany({ where: { siloSlug: job.siloSlug, estado: 'APROBADA' } });
    for (const s of aprobadas.filter((x) => modulos.includes(x.modulo) === (x.accion === 'ACTIVAR'))) {
      await this.prisma.solicitudModulo.update({
        where: { siloSlug_id: { siloSlug: s.siloSlug, id: s.id } },
        data: { estado: 'APLICADA', respuesta: s.respuesta ?? 'Aplicado', decididaPor: `job:${jobId}`, decididaEn: new Date(), errorEntrega: null },
      });
      await this.auditoria.registrar('control', 'modulo.solicitud_aplicada', `${s.siloSlug}/${s.modulo}`, `${s.accion} por job:${jobId} rev ${job.revision}`);
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
    if (job.tipo === 'APROVISIONAR') await this.aprov.alCancelar(job, op.correo);
  }

  /**
   * Confirmacion manual del operador en APROVISIONAR:
   *   P5 (job ESPERANDO_LLAVES): corrio infra/scripts/llaves/aprovisionar.sh del ERP. Se
   *      registran los custodios y la fecha, nunca las partes. P5 queda OK.
   *   P8 (job ESPERANDO_OPERADOR): configuro la ruta del dominio en el tunel. P8 vuelve
   *      al agente, que verifica de nuevo (la confirmacion no reemplaza la verificacion).
   * El job vuelve a PENDIENTE y el agente lo retoma desde el paso siguiente.
   */
  async confirmar(id: number, paso: string, nota: string, op: OperadorSesion, ip: string | null, custodios?: { nombre: string; rol: string }[]) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: { pasos: true } });
    if (!job) throw new NotFoundException();
    if (job.tipo !== 'APROVISIONAR') throw new UnprocessableEntityException({ mensaje: 'Solo APROVISIONAR tiene pasos manuales' });
    const p = job.pasos.find((x) => x.codigo === paso);
    if (!p || (paso !== 'P5' && paso !== 'P8')) throw new UnprocessableEntityException({ mensaje: 'Paso sin confirmacion manual' });
    const esperado = paso === 'P5' ? 'ESPERANDO_LLAVES' : 'ESPERANDO_OPERADOR';
    if (job.estado !== esperado) throw new ConflictException({ mensaje: `El job esta ${job.estado}, no ${esperado}` });
    // P5: tres custodios, uno por parte (2 de 3), los mismos con que se corrio el script del ERP.
    const filas = (custodios ?? []).map((c) => ({ nombre: c.nombre.replace(/\s+/g, ' ').trim(), rol: c.rol.replace(/\s+/g, ' ').trim() }));
    if (paso === 'P5' && (filas.length !== 3 || filas.some((c) => c.nombre.length < 2 || c.rol.length < 2 || /[:,]/.test(c.nombre + c.rol)))) {
      throw new UnprocessableEntityException({ mensaje: 'Indica los 3 custodios de las partes: nombre y rol de cada uno' });
    }
    const texto = paso === 'P5' ? filas.map((c) => `${c.nombre} (${c.rol})`).join(', ') : nota.replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
    const ahora = new Date();
    const linea = `${paso === 'P5' ? 'llaves confirmadas' : 'ruta del dominio confirmada'} por ${op.correo} el ${ahora.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    const cambio = await this.prisma.$transaction(async (tx) => {
      const r = await tx.job.updateMany({ where: { id, estado: esperado }, data: { estado: 'PENDIENTE', agenteId: null, reservaHasta: null } });
      if (r.count !== 1) return false;
      await tx.pasoJob.update({
        where: { id: p.id },
        data:
          paso === 'P5'
            ? { estado: 'OK', inicioEn: p.inicioEn ?? ahora, finEn: ahora, intentos: { increment: 1 }, log: [linea, ...filas.map((c, i) => `parte ${i + 1}: ${c.nombre} (${c.rol})`)], error: null }
            : { estado: 'PENDIENTE', log: [...p.log, linea, ...(texto ? [`nota: ${texto}`] : [])].slice(-30), error: null },
      });
      return true;
    });
    if (!cambio) throw new ConflictException({ mensaje: 'El job cambio mientras tanto. Recarga.' });
    await this.auditoria.registrar(op.correo, paso === 'P5' ? 'job.llaves_confirmadas' : 'job.dominio_confirmado', `job:${id}`, [paso === 'P5' ? `custodios: ${texto}` : texto, ip].filter(Boolean).join(' · '));
    return this.detalle(id);
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
      referencia: job.referencia,
      manifiesto: rev?.contenido ?? null,
      pasos: job.pasos.filter((p) => p.ejecutor === 'agente').map((p) => ({ codigo: p.codigo, estado: p.estado })),
    };
  }

  /** Reporte de un paso. Renueva la reserva. Si el job ya no es de este agente o se cancelo: 409 y el agente se detiene. */
  async reportarPaso(
    agenteId: number,
    jobId: number,
    codigo: string,
    estado: EstadoPaso,
    lineas: unknown,
    error?: string,
    extra: { espera?: string; datos?: DatosP2 } = {},
  ) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { pasos: true } });
    if (!job) throw new NotFoundException();
    if (job.agenteId !== agenteId) throw new ForbiddenException();
    if (job.estado !== 'EN_CURSO') throw new ConflictException({ mensaje: `Job ${job.estado}`, detener: true });
    const paso = job.pasos.find((p) => p.codigo === codigo && p.ejecutor === 'agente');
    if (!paso) throw new NotFoundException({ mensaje: `Paso ${codigo} no es del agente` });
    // Orden: un paso solo corre con los anteriores terminados (incluye los manuales del operador).
    if (!anterioresListos(job.pasos, paso.orden)) throw new ConflictException({ mensaje: `Hay pasos anteriores a ${codigo} sin terminar`, detener: true });
    const ahora = new Date();

    // El agente pide esperar al operador (APROVISIONAR: P6 sin llaves, P8 sin dominio).
    if (extra.espera) {
      const e = ESPERAS[extra.espera];
      if (job.tipo !== 'APROVISIONAR' || !e || e.paso !== codigo) throw new UnprocessableEntityException({ mensaje: `Espera ${extra.espera} no valida en ${codigo}` });
      const reabre = job.pasos.find((p) => p.codigo === e.reabre)!;
      await this.prisma.$transaction([
        this.prisma.pasoJob.update({ where: { id: paso.id }, data: { estado: 'PENDIENTE', finEn: ahora, log: limpiarLog(lineas), error: error?.slice(0, 500) ?? null } }),
        ...(reabre.id !== paso.id ? [this.prisma.pasoJob.update({ where: { id: reabre.id }, data: { estado: 'PENDIENTE', finEn: null } })] : []),
        this.prisma.job.update({ where: { id: jobId }, data: { estado: e.estado, agenteId: null, reservaHasta: null } }),
      ]);
      await this.auditoria.registrar(`agente:${agenteId}`, 'job.esperando', `job:${jobId}`, `${codigo}: ${error ?? e.estado}`.slice(0, 300));
      return { seguir: false };
    }
    if (extra.datos) {
      if (job.tipo !== 'APROVISIONAR' || codigo !== 'P2' || estado !== 'OK') throw new UnprocessableEntityException({ mensaje: 'Datos de imagen solo en P2 de APROVISIONAR' });
      await this.aprov.guardarDatosP2(job, extra.datos);
    }
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
    // Siguiente paso manual (APROVISIONAR P5): el job espera al operador y el agente se detiene.
    const sig = nuevo === 'EN_CURSO' ? siguientePaso(pasos) : undefined;
    if (sig?.ejecutor === 'operador') {
      const r = await this.prisma.job.updateMany({ where: { id: jobId, estado: 'EN_CURSO' }, data: { estado: 'ESPERANDO_LLAVES', agenteId: null, reservaHasta: null } });
      if (r.count === 1) await this.auditoria.registrar('control', 'job.esperando', `job:${jobId}`, `${sig.codigo}: ${sig.nombre}`);
      return { seguir: false };
    }
    if (nuevo !== 'EN_CURSO') {
      // Cierre condicionado al estado: si dos reportes finales llegan juntos, solo uno cierra el job
      // (una sola auditoria y un solo cerrarSolicitudes).
      const cerrado = await this.prisma.job.updateMany({
        where: { id: jobId, estado: 'EN_CURSO' },
        data: { estado: nuevo, terminadoEn: ahora, error: nuevo === 'FALLIDO' ? `${codigo}: ${error ?? 'fallo'}`.slice(0, 500) : null },
      });
      if (cerrado.count !== 1) return { seguir: false };
      await this.auditoria.registrar(`agente:${agenteId}`, nuevo === 'OK' ? 'job.ok' : 'job.fallido', `job:${jobId}`, nuevo === 'FALLIDO' ? `${codigo}: ${error ?? ''}` : job.siloSlug);
      if (nuevo === 'OK') {
        if (job.tipo === 'APROVISIONAR') {
          await this.aprov.alTerminar(job).catch((e: unknown) =>
            this.auditoria.registrar('control', 'aprovisionar.cierre_fallido', `job:${jobId}`, (e instanceof Error ? e.message : String(e)).slice(0, 300)),
          );
        }
        await this.cerrarSolicitudes(jobId);
        // El job ya quedo OK: un fallo al cerrar el paso de la salida no se le devuelve al agente.
        await this.cierre.alTerminarJob(job).catch((e: unknown) =>
          this.auditoria.registrar('control', 'salida.cierre_fallido', `job:${jobId}`, (e instanceof Error ? e.message : String(e)).slice(0, 300)),
        );
      }
    }
    return { seguir: nuevo === 'EN_CURSO' };
  }

  /** Solo el agente que tiene el job EN_CURSO la renueva. */
  async renovarReserva(agenteId: number, jobId: number) {
    const r = await this.prisma.job.updateMany({ where: { id: jobId, agenteId, estado: 'EN_CURSO' }, data: { reservaHasta: new Date(Date.now() + RESERVA_MS) } });
    return { seguir: r.count === 1 };
  }

  contarActivos() {
    return this.prisma.job.count({ where: { estado: { in: [...ACTIVOS] } } });
  }
}
