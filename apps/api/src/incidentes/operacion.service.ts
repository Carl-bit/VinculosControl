import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import type { OperadorSesion } from '../acceso/acceso.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../comun/prisma.service';
import { estadoSoporte, hitos, type Severidad, semaforo, venceSoporte } from './plazos';

/** Hitos que se registran una vez (el primer registro fija la fecha). */
const CAMPO_HITO = { contencion: 'contenidoEn', aviso_centro: 'avisoCentroEn', informe_final: 'informeFinalEn' } as const;
export const TIPOS_EVENTO = ['contencion', 'aviso_centro', 'actualizacion', 'informe_final', 'cierre', 'nota'] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

/**
 * Incidentes y soporte (CONTEXTO.md 8b). Todo fuera del silo y sin datos
 * personales: el texto describe el hecho tecnico, nunca pacientes ni equipo.
 */
@Injectable()
export class OperacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private conPlazos<T extends Omit<Parameters<typeof hitos>[0], 'severidad'> & { severidad: string }>(i: T, ahora = new Date()) {
    const hs = hitos({ ...i, severidad: i.severidad as Severidad }, ahora);
    return { ...i, hitos: hs, semaforo: i.cerradoEn ? 'cerrado' : semaforo(hs) };
  }

  // ---------- incidentes ----------

  async crearIncidente(d: { severidad: Severidad; titulo: string; siloSlug?: string; alertaId?: number; detectadoEn?: string; nota?: string }, op: OperadorSesion) {
    const detectadoEn = d.detectadoEn ? new Date(d.detectadoEn) : new Date();
    if (Number.isNaN(detectadoEn.getTime()) || detectadoEn > new Date()) throw new UnprocessableEntityException({ mensaje: 'Fecha de deteccion invalida (no puede ser futura)' });
    const centro = d.siloSlug ? await this.prisma.centro.findUnique({ where: { slug: d.siloSlug }, select: { id: true } }) : null;
    const i = await this.prisma.incidente.create({
      data: {
        severidad: d.severidad,
        titulo: d.titulo.trim(),
        siloSlug: d.siloSlug ?? null,
        centroId: centro?.id ?? null,
        alertaId: d.alertaId ?? null,
        detectadoEn,
        creadoPor: op.correo,
        eventos: { create: [{ tipo: 'apertura', texto: d.nota?.trim() || d.titulo.trim(), actor: op.correo, en: new Date() }] },
      },
    });
    await this.auditoria.registrar(op.correo, 'incidente.abierto', `incidente:${i.id}`, `${d.severidad} ${d.siloSlug ?? 'plataforma'}: ${d.titulo.slice(0, 120)}`);
    return this.detalleIncidente(i.id);
  }

  async listarIncidentes(abiertos: boolean) {
    const filas = await this.prisma.incidente.findMany({ where: abiertos ? { cerradoEn: null } : undefined, orderBy: { detectadoEn: 'desc' }, take: 200 });
    const ahora = new Date();
    return filas.map((i) => this.conPlazos(i, ahora));
  }

  async detalleIncidente(id: number) {
    const i = await this.prisma.incidente.findUnique({ where: { id }, include: { eventos: { orderBy: { en: 'asc' } } } });
    if (!i) throw new NotFoundException();
    return this.conPlazos(i);
  }

  /**
   * Registra un hito o una nota. Contencion, aviso e informe final se fijan
   * una vez; las actualizaciones mueven la proxima; el cierre exige el informe
   * final (salvo S3 sin aviso, que igual lo exige: el informe cierra el caso).
   */
  async registrar(id: number, tipo: TipoEvento, texto: string, op: OperadorSesion) {
    const i = await this.prisma.incidente.findUnique({ where: { id } });
    if (!i) throw new NotFoundException();
    if (i.cerradoEn) throw new UnprocessableEntityException({ mensaje: 'El incidente esta cerrado' });
    const ahora = new Date();
    const data: Record<string, Date> = {};
    if (tipo in CAMPO_HITO) {
      const campo = CAMPO_HITO[tipo as keyof typeof CAMPO_HITO];
      if (i[campo]) throw new UnprocessableEntityException({ mensaje: `Ese hito ya se registro` });
      if (tipo === 'informe_final' && !i.contenidoEn) throw new UnprocessableEntityException({ mensaje: 'Primero registra la contencion' });
      data[campo] = ahora;
    }
    if (tipo === 'actualizacion') {
      if (!i.avisoCentroEn) throw new UnprocessableEntityException({ mensaje: 'Las actualizaciones van despues del aviso al centro' });
      data.ultimaActualizacionEn = ahora;
    }
    if (tipo === 'cierre') {
      if (!i.informeFinalEn) throw new UnprocessableEntityException({ mensaje: 'Para cerrar falta el informe final' });
      data.cerradoEn = ahora;
    }
    await this.prisma.$transaction([
      this.prisma.incidente.update({ where: { id }, data }),
      this.prisma.eventoIncidente.create({ data: { incidenteId: id, tipo, texto: texto.trim(), actor: op.correo, en: ahora } }),
    ]);
    await this.auditoria.registrar(op.correo, `incidente.${tipo}`, `incidente:${id}`, texto.slice(0, 200));
    return this.detalleIncidente(id);
  }

  // ---------- soporte ----------

  async crearSoporte(d: { siloSlug: string; motivo: string; alcance: string; autorizadaEn: string; horas: number }, op: OperadorSesion) {
    const autorizadaEn = new Date(d.autorizadaEn);
    if (Number.isNaN(autorizadaEn.getTime()) || autorizadaEn > new Date()) throw new UnprocessableEntityException({ mensaje: 'Fecha de autorizacion invalida' });
    const venceEn = venceSoporte(autorizadaEn, d.horas);
    if (venceEn <= new Date()) throw new UnprocessableEntityException({ mensaje: 'La autorizacion del ADMIN ya vencio: pide una nueva en el silo' });
    const centro = await this.prisma.centro.findUnique({ where: { slug: d.siloSlug }, select: { id: true } });
    const s = await this.prisma.solicitudSoporte.create({
      data: { siloSlug: d.siloSlug, centroId: centro?.id ?? null, motivo: d.motivo.trim(), alcance: d.alcance, autorizadaEn, venceEn, creadoPor: op.correo },
    });
    await this.auditoria.registrar(op.correo, 'soporte.abierto', `soporte:${s.id}`, `${d.siloSlug} ${d.alcance} hasta ${venceEn.toISOString()}`);
    return s;
  }

  async listarSoporte() {
    const ahora = new Date();
    const filas = await this.prisma.solicitudSoporte.findMany({ orderBy: { creadoEn: 'desc' }, take: 200 });
    return filas.map((s) => ({ ...s, estado: estadoSoporte(s, ahora) }));
  }

  async cerrarSoporte(id: number, resultado: string, op: OperadorSesion) {
    const s = await this.prisma.solicitudSoporte.findUnique({ where: { id } });
    if (!s) throw new NotFoundException();
    if (s.estado !== 'ABIERTA') throw new UnprocessableEntityException({ mensaje: 'Ya esta cerrada' });
    await this.prisma.solicitudSoporte.update({ where: { id }, data: { estado: 'CERRADA', resultado: resultado.trim(), cerradaEn: new Date() } });
    await this.auditoria.registrar(op.correo, 'soporte.cerrado', `soporte:${id}`, resultado.slice(0, 200));
  }

  contarIncidentesAbiertos() {
    return this.prisma.incidente.count({ where: { cerradoEn: null } });
  }
}
