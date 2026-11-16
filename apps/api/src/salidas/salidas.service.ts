import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { type EstadoCentro, Prisma, type Salida } from '@prisma/client';
import { hashManifiesto } from '@vinculos/manifest/hash';

import type { OperadorSesion } from '../acceso/acceso.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { num, PrismaService } from '../comun/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { SalidasCierre } from './cierre.service';
import {
  bloqueosEliminar,
  CHECKLIST,
  type Checklist,
  diasRestantes,
  erroresRecepcion,
  expediente,
  faltanEnChecklist,
  GRACIA_DIAS,
  graciaHasta,
  type MedioConfirmacion,
  normalizarHuella,
  ORIGENES,
  pasos,
  REVERTIBLES,
} from './reglas';

export interface Inicio {
  centroId: number;
  fechaCorte: string;
  motivo: string;
  /** El operador escribe el slug para confirmar. */
  confirmacion: string;
}
export interface Recepcion {
  exporteEn: string;
  exporteBytes: number;
  exporteHuella: string;
  firmadaEn: string;
  recibeNombre: string;
  recibeCargo: string;
  conteoPacientes: number;
  conteoFichas: number;
  huellaActa: string;
  graciaDias?: number;
}
export interface Confirmacion {
  en: string;
  medio: MedioConfirmacion;
  referencia: string;
}
export interface Eliminacion {
  checklist: Checklist;
  nota?: string;
  confirmacion: string;
}
export interface Reversion {
  /** Solicitud escrita del centro (fecha, medio, referencia), sin datos personales. */
  solicitudEn: string;
  medio: MedioConfirmacion;
  referencia: string;
  motivo: string;
  confirmacion: string;
}

/** El agente reporta metricas cada minuto: con contenedores en marcha en los ultimos 5 min, el silo no esta detenido. */
const VENTANA_METRICAS_MS = 5 * 60_000;
/** Items del checklist S7 que prueba el job ELIMINAR (el resto los marca el operador). */
const POR_JOB: readonly string[] = ['detenido', 'volumenes', 'respaldosHost'];

/**
 * Protocolo de salida (S1-S8) y su reversion. Cada paso mueve el estado del
 * centro con transicion + auditoria y es idempotente: repetir el mismo paso
 * con los mismos datos no crea nada nuevo; con datos distintos, 409.
 * Los pasos fisicos van por jobs del ejecutor (opciones B y C) o, sin
 * ejecutor, a mano con la confirmacion correspondiente.
 */
@Injectable()
export class SalidasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly jobs: JobsService,
    private readonly cierre: SalidasCierre,
  ) {}

  async listar() {
    const filas = await this.prisma.salida.findMany({ orderBy: { iniciadaEn: 'desc' }, include: { centro: { select: { nombre: true, estado: true } } } });
    const ahora = new Date();
    return filas.map((s) => ({
      id: s.id,
      centroId: s.centroId,
      siloSlug: s.siloSlug,
      nombre: s.centro.nombre,
      estado: s.centro.estado,
      expediente: expediente(s),
      fechaCorte: s.fechaCorte,
      iniciadaEn: s.iniciadaEn,
      graciaHasta: s.graciaHasta,
      diasGracia: s.abierta && !s.eliminadoEn ? diasRestantes(s.graciaHasta, ahora) : null,
      eliminadoEn: s.eliminadoEn,
      revertidaEn: s.revertidaEn,
    }));
  }

  async detalle(id: number) {
    const s = await this.prisma.salida.findUnique({ where: { id }, include: { centro: { select: { nombre: true, estado: true, slug: true } } } });
    if (!s) throw new NotFoundException({ mensaje: 'Salida inexistente' });
    const ahora = new Date();
    const { centro, ...resto } = s;
    const ids = [s.detencionJobId, s.eliminacionJobId, s.reversionJobId].filter((x): x is number => !!x);
    const [jobs, envios, eliminacionLog] = await Promise.all([
      this.prisma.job.findMany({ where: { centroId: s.centroId, tipo: { in: ['SOLO_LECTURA', 'DETENER_SILO', 'REANUDAR_SILO', 'ELIMINAR'] }, creadoEn: { gte: s.iniciadaEn } }, orderBy: { id: 'desc' }, take: 10, select: { id: true, tipo: true, estado: true, creadoEn: true, error: true } }),
      this.envios(id),
      s.eliminacionJobId ? this.prisma.pasoJob.findFirst({ where: { jobId: s.eliminacionJobId, codigo: 'X2' }, select: { log: true } }) : null,
    ]);
    const abierta = !!s.abierta;
    return {
      ...resto,
      exporteBytes: num(s.exporteBytes),
      nombre: centro.nombre,
      estado: centro.estado,
      expediente: expediente(s),
      diasGracia: diasRestantes(s.graciaHasta, ahora),
      pasos: pasos(abierta ? centro.estado : 'ELIMINADO', s),
      bloqueosEliminar: abierta && centro.estado === 'GRACIA' ? bloqueosEliminar(s, centro.estado, ahora) : [],
      puedeRevertir: abierta && !s.reversionPedidaEn && !s.eliminadoEn && !s.eliminacionJobId && REVERTIBLES.includes(centro.estado),
      checklist: CHECKLIST,
      porJob: s.eliminacionJobId ? POR_JOB : [],
      evidenciaEliminacion: eliminacionLog?.log ?? [],
      jobs,
      jobsRelacionados: ids,
      envios,
    };
  }

  /** Envios de actas (desde la auditoria: no hace falta otra tabla). */
  private async envios(salidaId: number) {
    const ev = await this.prisma.eventoAuditoria.findMany({
      where: { objeto: `salida:${salidaId}`, accion: { in: ['salida.acta_enviada', 'salida.acta_no_enviada'] } },
      orderBy: { en: 'desc' },
      take: 10,
      select: { en: true, accion: true, detalle: true },
    });
    return ev.map((e) => {
      const [tipo, para] = (e.detalle ?? '').split(' · ');
      return { en: e.en, ok: e.accion === 'salida.acta_enviada', tipo, para };
    });
  }

  /** S1: termino de contrato con fecha de corte. ACTIVO / ACTIVO_SIN_DOMINIO / SUSPENDIDO -> EN_SALIDA. */
  async iniciar(d: Inicio, op: OperadorSesion, ip: string | null) {
    const c = await this.prisma.centro.findUnique({ where: { id: d.centroId }, include: { salidas: { where: { abierta: true } } } });
    if (!c) throw new NotFoundException();
    const abierta = c.salidas[0];
    if (abierta) {
      if (abierta.motivo === d.motivo.trim() && fechaIso(abierta.fechaCorte) === d.fechaCorte) return this.detalle(abierta.id);
      throw new ConflictException({ mensaje: `Este centro ya tiene una salida abierta (${c.estado})` });
    }
    if (!c.slug) throw new UnprocessableEntityException({ mensaje: 'El centro no tiene silo (sin slug)' });
    if (!ORIGENES.includes(c.estado)) throw new UnprocessableEntityException({ mensaje: `Una salida se inicia desde ${ORIGENES.join(', ')} (el centro esta en ${c.estado})` });
    if (d.confirmacion.trim() !== c.slug) throw new UnprocessableEntityException({ mensaje: `Para confirmar escribe el slug del silo (${c.slug})` });
    const slug = c.slug;
    let id = 0;
    await this.cierre.transitar(c.id, c.estado, 'EN_SALIDA', op.correo, d.motivo.trim(), async (tx) => {
      const s = await tx.salida.create({ data: { centroId: c.id, siloSlug: slug, fechaCorte: new Date(`${d.fechaCorte}T00:00:00Z`), motivo: d.motivo.trim(), desde: c.estado, iniciadaPor: op.correo } });
      id = s.id;
    });
    await this.auditoria.registrar(op.correo, 'salida.iniciada', `centro:${c.id}`, `${slug} · corte ${d.fechaCorte}${ip ? ` · ${ip}` : ''}`);
    // S2 (R12): el silo pasa a solo lectura; lectura, exportes y derechos siguen.
    await this.jobs.crearSoloLectura(c.id, slug, { fechaCorte: d.fechaCorte }, op.correo, ip);
    return this.detalle(id);
  }

  /** S3-S5: exporte (fecha, tamano, huella del registro del silo) + acta de recepcion firmada. EN_SALIDA -> EXPORTADO. */
  async registrarRecepcion(id: number, d: Recepcion, op: OperadorSesion, ip: string | null) {
    const { c, s } = await this.cargar(id);
    const datos = {
      exporteEn: new Date(d.exporteEn),
      exporteBytes: BigInt(d.exporteBytes),
      exporteHuella: normalizarHuella(d.exporteHuella),
      actaRecepcionFirmadaEn: new Date(d.firmadaEn),
      recibeNombre: d.recibeNombre.trim(),
      recibeCargo: d.recibeCargo.trim(),
      conteoPacientes: d.conteoPacientes,
      conteoFichas: d.conteoFichas,
      graciaDias: d.graciaDias ?? GRACIA_DIAS.defecto,
    };
    const acta = {
      tipo: 'acta_recepcion',
      centro: c.nombre,
      silo: s.siloSlug,
      exporte: { en: datos.exporteEn.toISOString(), bytes: d.exporteBytes, huella: datos.exporteHuella },
      firmadaEn: datos.actaRecepcionFirmadaEn.toISOString(),
      recibe: { nombre: datos.recibeNombre, cargo: datos.recibeCargo },
      conteos: { pacientes: datos.conteoPacientes, fichas: datos.conteoFichas },
      graciaDias: datos.graciaDias,
    };
    const hash = hashManifiesto(acta);
    if (s.actaRecepcionHash) {
      if (s.actaRecepcionHash === hash) return this.detalle(id);
      throw new ConflictException({ mensaje: 'El acta de recepcion ya esta registrada con otros datos' });
    }
    this.exigirAbierta(s);
    if (c.estado !== 'EN_SALIDA') throw new UnprocessableEntityException({ mensaje: `El acta se registra con el centro EN_SALIDA (esta en ${c.estado})` });
    const errores = erroresRecepcion({ exporteEn: datos.exporteEn, exporteHuella: d.exporteHuella, firmadaEn: datos.actaRecepcionFirmadaEn, huellaActa: d.huellaActa }, s.iniciadaEn, new Date());
    if (errores.length) throw new UnprocessableEntityException({ mensaje: errores.join('. '), errores });
    await this.cierre.transitar(c.id, 'EN_SALIDA', 'EXPORTADO', op.correo, `acta ${hash.slice(0, 12)}`, (tx) =>
      tx.salida.update({ where: { id }, data: { ...datos, actaRecepcionHash: hash, actaRecepcionPor: op.correo, graciaHasta: graciaHasta(datos.actaRecepcionFirmadaEn, datos.graciaDias) } }),
    );
    await this.auditoria.registrar(op.correo, 'salida.acta_recepcion', `centro:${c.id}`, `${s.siloSlug} · huella ${datos.exporteHuella.slice(0, 12)} · acta ${hash.slice(0, 12)}${ip ? ` · ${ip}` : ''}`);
    return this.detalle(id);
  }

  /** S6 por el ejecutor (opcion B): encola DETENER_SILO. Al terminar OK, el centro pasa a GRACIA. */
  async detener(id: number, op: OperadorSesion, ip: string | null) {
    const { c, s } = await this.cargar(id);
    this.exigirAbierta(s);
    if (s.siloDetenidoEn) return this.detalle(id);
    if (c.estado !== 'EXPORTADO') throw new UnprocessableEntityException({ mensaje: `El silo se detiene con el centro EXPORTADO (esta en ${c.estado})` });
    await this.jobs.crearDeSalida('DETENER_SILO', s, op, ip);
    return this.detalle(id);
  }

  /**
   * S6 a mano (sin ejecutor): el operador detuvo el silo. Se rechaza si el agente
   * reporto contenedores en marcha hace menos de 5 min.
   */
  async siloDetenido(id: number, op: OperadorSesion) {
    const { c, s } = await this.cargar(id);
    this.exigirAbierta(s);
    if (s.siloDetenidoEn) return this.detalle(id);
    if (c.estado !== 'EXPORTADO') throw new UnprocessableEntityException({ mensaje: `El silo se detiene con el centro EXPORTADO (esta en ${c.estado})` });
    const enMarcha = await this.enMarcha(s.siloSlug);
    if (enMarcha) throw new ConflictException({ mensaje: `El agente vio ${enMarcha.servicio} de erp-${s.siloSlug} en marcha a las ${enMarcha.en.toISOString().slice(11, 16)} UTC. Detener el silo y esperar el siguiente reporte` });
    await this.cierre.siloDetenido(id, op.correo, null);
    return this.detalle(id);
  }

  /** S6b: confirmacion escrita del centro antes de borrar (fecha, medio y referencia, sin datos personales). */
  async confirmar(id: number, d: Confirmacion, op: OperadorSesion, ip: string | null) {
    const { c, s } = await this.cargar(id);
    const en = new Date(d.en);
    const ref = d.referencia.trim();
    if (s.confirmacionEn) {
      if (s.confirmacionEn.getTime() === en.getTime() && s.confirmacionMedio === d.medio && s.confirmacionRef === ref) return this.detalle(id);
      throw new ConflictException({ mensaje: 'La confirmacion ya esta registrada con otros datos' });
    }
    this.exigirAbierta(s);
    if (c.estado !== 'EXPORTADO' && c.estado !== 'GRACIA') throw new UnprocessableEntityException({ mensaje: `La confirmacion se registra tras el acta de recepcion (el centro esta en ${c.estado})` });
    if (en > new Date()) throw new UnprocessableEntityException({ mensaje: 'La fecha de la confirmacion esta en el futuro' });
    if (s.actaRecepcionFirmadaEn && en < s.actaRecepcionFirmadaEn) throw new UnprocessableEntityException({ mensaje: 'La confirmacion no puede ser anterior al acta de recepcion' });
    await this.prisma.salida.update({ where: { id }, data: { confirmacionEn: en, confirmacionMedio: d.medio, confirmacionRef: ref, confirmacionPor: op.correo } });
    await this.auditoria.registrar(op.correo, 'salida.confirmacion', `centro:${c.id}`, `${s.siloSlug} · ${d.medio.toLowerCase()}${ip ? ` · ${ip}` : ''}`);
    return this.detalle(id);
  }

  /**
   * S7 por el ejecutor (opcion C): encola ELIMINAR con el hash del acta de
   * recepcion. El ejecutor exige ademas el consentimiento local bajas/<slug>.
   */
  async eliminarSilo(id: number, d: { confirmacion: string }, op: OperadorSesion, ip: string | null) {
    const { c, s } = await this.cargar(id);
    this.exigirAbierta(s);
    if (s.eliminacionJobId) return this.detalle(id);
    const bloqueos = bloqueosEliminar(s, c.estado, new Date());
    if (bloqueos.length) throw new UnprocessableEntityException({ mensaje: bloqueos.join('. '), errores: bloqueos });
    if (d.confirmacion.trim() !== s.siloSlug) throw new UnprocessableEntityException({ mensaje: `Para confirmar escribe el slug del silo (${s.siloSlug})` });
    await this.jobs.crearDeSalida('ELIMINAR', s, op, ip);
    return this.detalle(id);
  }

  /**
   * S7: acta de eliminacion. GRACIA -> ELIMINADO. Si el job ELIMINAR termino OK,
   * sus items (detenido, volumenes, respaldos del host) quedan probados por el
   * job y su log va al acta como evidencia; el resto los marca el operador.
   */
  async eliminar(id: number, d: Eliminacion, op: OperadorSesion, ip: string | null) {
    const { c, s } = await this.cargar(id);
    if (s.eliminadoEn) return this.detalle(id);
    this.exigirAbierta(s);
    const bloqueos = bloqueosEliminar(s, c.estado, new Date());
    if (bloqueos.length) throw new UnprocessableEntityException({ mensaje: bloqueos.join('. '), errores: bloqueos });
    const evidencia = s.eliminacionJobId ? await this.prisma.pasoJob.findFirst({ where: { jobId: s.eliminacionJobId, codigo: 'X2' }, select: { log: true } }) : null;
    const marcas: Record<string, unknown> = { ...d.checklist, ...(s.eliminacionJobId ? Object.fromEntries(POR_JOB.map((k) => [k, true])) : {}) };
    const faltan = faltanEnChecklist(marcas);
    if (faltan.length) throw new UnprocessableEntityException({ mensaje: `Falta en el checklist: ${faltan.join('; ')}`, errores: faltan });
    if (d.confirmacion.trim() !== s.siloSlug) throw new UnprocessableEntityException({ mensaje: `Para confirmar escribe el slug del silo (${s.siloSlug})` });
    const ahora = new Date();
    const acta = {
      tipo: 'acta_eliminacion',
      centro: c.nombre,
      silo: s.siloSlug,
      fechaCorte: fechaIso(s.fechaCorte),
      actaRecepcion: s.actaRecepcionHash,
      exporteHuella: s.exporteHuella,
      eliminadoEn: ahora.toISOString(),
      eliminadoPor: op.correo,
      items: Object.fromEntries(CHECKLIST.map((i) => [i.clave, s.eliminacionJobId && POR_JOB.includes(i.clave) ? `job:${s.eliminacionJobId}` : 'operador'])),
      evidencia: evidencia?.log ?? null,
      nota: d.nota?.trim() || null,
      texto: `Eliminado de produccion y respaldos el dia ${ahora.toISOString().slice(0, 10)}`,
    };
    const hash = hashManifiesto(acta);
    await this.cierre.transitar(c.id, 'GRACIA', 'ELIMINADO', op.correo, `acta ${hash.slice(0, 12)}`, (tx) =>
      tx.salida.update({ where: { id }, data: { actaEliminacion: acta as Prisma.InputJsonValue, actaEliminacionHash: hash, eliminadoEn: ahora, eliminadoPor: op.correo } }),
    );
    await this.auditoria.registrar(op.correo, 'salida.eliminado', `centro:${c.id}`, `${s.siloSlug} · acta ${hash.slice(0, 12)}${ip ? ` · ${ip}` : ''}`);
    await this.cierre.enviarActa(id, 'eliminacion', op.correo);
    return this.detalle(id);
  }

  /**
   * Reversion (baja por error o arrepentimiento), con la solicitud escrita del
   * centro. EN_SALIDA o EXPORTADO: vuelve al estado previo en el acto. GRACIA con
   * el silo detenido: encola REANUDAR_SILO y al terminar OK vuelve (o, sin
   * ejecutor, el operador lo levanta y confirma). Despues del job ELIMINAR o del
   * acta S7 no hay reversion.
   */
  async revertir(id: number, d: Reversion, op: OperadorSesion, ip: string | null) {
    const { c, s } = await this.cargar(id);
    if (s.revertidaEn) return this.detalle(id);
    const pedido = { reversionSolicitudEn: new Date(d.solicitudEn), reversionMedio: d.medio, reversionRef: d.referencia.trim(), reversionMotivo: d.motivo.trim() };
    if (s.reversionPedidaEn) {
      if (s.reversionRef === pedido.reversionRef && s.reversionMotivo === pedido.reversionMotivo) return this.detalle(id);
      throw new ConflictException({ mensaje: 'Ya hay una reversion pedida con otros datos' });
    }
    if (s.eliminadoEn || s.eliminacionJobId) throw new UnprocessableEntityException({ mensaje: 'El silo ya se elimino: la salida no se puede revertir' });
    const activo = await this.prisma.job.findFirst({ where: { centroId: c.id, tipo: 'ELIMINAR', estado: { in: ['PENDIENTE', 'EN_CURSO'] } }, select: { id: true } });
    if (activo) throw new ConflictException({ mensaje: `Hay un job ELIMINAR en curso (#${activo.id}): cancelarlo antes de revertir` });
    // Un ELIMINAR que alcanzo a empezar el borrado (X2) pudo dejar el silo a medias: ya no se revierte.
    const borrado = await this.prisma.pasoJob.findFirst({
      where: { codigo: 'X2', estado: { not: 'PENDIENTE' }, job: { centroId: c.id, tipo: 'ELIMINAR', creadoEn: { gte: s.iniciadaEn } } },
      select: { jobId: true },
    });
    if (borrado) throw new UnprocessableEntityException({ mensaje: `El job ELIMINAR #${borrado.jobId} ya empezo a borrar: la salida no se puede revertir` });
    if (!REVERTIBLES.includes(c.estado)) throw new UnprocessableEntityException({ mensaje: `Una salida se revierte en ${REVERTIBLES.join(', ')} (el centro esta en ${c.estado})` });
    if (pedido.reversionSolicitudEn > new Date() || pedido.reversionSolicitudEn < s.iniciadaEn) throw new UnprocessableEntityException({ mensaje: 'La solicitud del centro debe ser posterior al inicio de la salida y no futura' });
    if (d.confirmacion.trim() !== s.siloSlug) throw new UnprocessableEntityException({ mensaje: `Para confirmar escribe el slug del silo (${s.siloSlug})` });
    await this.prisma.salida.update({ where: { id }, data: { ...pedido, reversionPedidaPor: op.correo, reversionPedidaEn: new Date() } });
    await this.auditoria.registrar(op.correo, 'salida.reversion_pedida', `centro:${c.id}`, `${s.siloSlug} · ${c.estado}${ip ? ` · ${ip}` : ''}`);
    if (s.siloDetenidoEn) {
      const job = await this.jobs.crearDeSalida('REANUDAR_SILO', s, op, ip);
      await this.prisma.salida.update({ where: { id }, data: { reversionJobId: job.id } });
    } else {
      await this.cierre.completarReversion(id, op.correo, null);
      // R12: el silo sigue en marcha; vuelve a aceptar escrituras.
      await this.jobs.crearSoloLectura(c.id, s.siloSlug, 'QUITAR', op.correo, ip);
    }
    return this.detalle(id);
  }

  /** Reversion sin ejecutor: el operador levanto el silo a mano; el agente debe verlo en marcha (ultimos 5 min). */
  async confirmarReanudado(id: number, op: OperadorSesion) {
    const { s } = await this.cargar(id);
    if (s.revertidaEn) return this.detalle(id);
    if (!s.reversionPedidaEn) throw new UnprocessableEntityException({ mensaje: 'No hay una reversion pedida' });
    if (!(await this.enMarcha(s.siloSlug))) throw new ConflictException({ mensaje: `El agente no ve erp-${s.siloSlug} en marcha en los ultimos 5 min: levantar el silo y esperar el siguiente reporte` });
    await this.cierre.completarReversion(id, op.correo, null);
    return this.detalle(id);
  }

  enviarActa(id: number, tipo: 'eliminacion' | 'reversion', op: OperadorSesion) {
    return this.cierre.enviarActa(id, tipo, op.correo);
  }

  private enMarcha(slug: string) {
    return this.prisma.metricaContenedor.findFirst({
      where: { slug, estado: 'running', en: { gte: new Date(Date.now() - VENTANA_METRICAS_MS) } },
      select: { servicio: true, en: true },
    });
  }

  private exigirAbierta(s: Salida) {
    if (!s.abierta) throw new UnprocessableEntityException({ mensaje: 'Esta salida esta cerrada (revertida)' });
    if (s.reversionPedidaEn) throw new UnprocessableEntityException({ mensaje: 'Hay una reversion pedida: la salida no avanza' });
  }

  private async cargar(id: number): Promise<{ c: { id: number; nombre: string; estado: EstadoCentro }; s: Salida }> {
    const s = await this.prisma.salida.findUnique({ where: { id }, include: { centro: { select: { id: true, nombre: true, estado: true } } } });
    if (!s) throw new NotFoundException({ mensaje: 'Salida inexistente' });
    const { centro, ...resto } = s;
    return { c: centro, s: resto as Salida };
  }
}

const fechaIso = (d: Date) => d.toISOString().slice(0, 10);
