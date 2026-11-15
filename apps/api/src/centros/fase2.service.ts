import { createHash, randomBytes } from 'node:crypto';

import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { EstadoCentro } from '@prisma/client';
import {
  type Borrador,
  borradorCentroSchema,
  borradorSchema,
  CAMPOS_CENTRO,
  datosCentroSchema,
  mezclarBorradorCentro,
  SLUG,
  sugerirSlug,
  validarP0,
} from '@vinculos/manifest';

import type { OperadorSesion } from '../acceso/acceso.service';
import { CorreoService } from '../acceso/correo.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../comun/prisma.service';
import { ANTES_DE_APROBADO } from './estados';
import { guardarRevision, leerBorrador } from './borrador';

const DIAS_ENLACE = 7;
/** El centro edita por su enlace mientras la reunion ya ocurrio y no esta aprobado. */
const EDITABLE_CENTRO: readonly EstadoCentro[] = ['REUNION', 'DATOS_COMPLETOS'];
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/** Solo los campos del centro (lo que ve y edita por su enlace). */
const parteCentro = (b: Borrador) => Object.fromEntries(CAMPOS_CENTRO.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));

/**
 * Fase 2b: slug, enlace privado, borrador editable por ambas partes,
 * validacion P0 y aprobacion (CONTEXTO.md secciones 2, 3 y 5).
 */
@Injectable()
export class Fase2Service {
  /** Direccion publica de la landing: alli vive el enlace privado de fase 2 (/manifiesto/<token>). */
  private readonly sitioUrl = (process.env.LANDING_URL ?? 'http://127.0.0.1:3300').replace(/\/$/, '');
  readonly dominioBase = process.env.DOMINIO_BASE ?? 'vinculos.cl';

  constructor(
    private readonly prisma: PrismaService,
    private readonly correo: CorreoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async centro(id: number) {
    const c = await this.prisma.centro.findUnique({ where: { id } });
    if (!c) throw new NotFoundException();
    return c;
  }

  private exigirAntesDeAprobado(estado: EstadoCentro) {
    if (!ANTES_DE_APROBADO.includes(estado)) throw new UnprocessableEntityException({ mensaje: `En ${estado} el manifiesto ya no se edita (solo antes de APROBADO)` });
  }

  /** Datos de fase 2 para el detalle de la consola. */
  async resumen(id: number, slug: string | null, nombre: string) {
    const [{ borrador, revision }, enlace] = await Promise.all([
      leerBorrador(this.prisma, id),
      this.prisma.enlaceFase2.findFirst({ where: { centroId: id }, orderBy: { creadoEn: 'desc' } }),
    ]);
    const datosCentro = datosCentroSchema.safeParse(parteCentro(borrador));
    return {
      borrador,
      revisionBorrador: revision,
      p0: validarP0(borrador, slug),
      datosCentroCompletos: datosCentro.success,
      faltanCentro: datosCentro.success ? [] : datosCentro.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      slugSugerido: slug ?? sugerirSlug(nombre),
      dominioBase: this.dominioBase,
      enlace: enlace && {
        enviadoA: enlace.enviadoA,
        creadoEn: enlace.creadoEn,
        venceEn: enlace.venceEn,
        ultimoUsoEn: enlace.ultimoUsoEn,
        activo: !enlace.revocadoEn && enlace.venceEn > new Date(),
        revocado: !!enlace.revocadoEn,
      },
    };
  }

  /** Lo usa la transicion manual a DATOS_COMPLETOS: solo si lo del centro esta completo. */
  async datosCentroCompletos(id: number): Promise<string | null> {
    const { borrador } = await leerBorrador(this.prisma, id);
    const r = datosCentroSchema.safeParse(parteCentro(borrador));
    return r.success ? null : `Faltan datos del centro: ${r.error.issues.map((i) => i.path.join('.')).join(', ')}`;
  }

  async definirSlug(id: number, slug: string, op: OperadorSesion, ip: string | null) {
    const c = await this.centro(id);
    this.exigirAntesDeAprobado(c.estado);
    if (!SLUG.test(slug)) throw new BadRequestException({ mensaje: 'Slug: minusculas, numeros y guiones; 3 a 40; empieza con letra' });
    if (c.slug === slug) return;
    const [otro, silo] = await Promise.all([
      this.prisma.centro.findUnique({ where: { slug }, select: { id: true } }),
      this.prisma.silo.findUnique({ where: { slug }, select: { slug: true } }),
    ]);
    if (otro || silo) throw new ConflictException({ mensaje: `El slug ${slug} ya esta en uso` });
    await this.prisma.centro.update({ where: { id }, data: { slug } });
    await this.auditoria.registrar(op.correo, 'centro.slug', `centro:${id}`, `${c.slug ?? '-'} -> ${slug}${ip ? ` · ${ip}` : ''}`);
  }

  /** Crea (o rota) el enlace privado y lo manda al contacto del centro. Devuelve la URL una vez, por si hay que reenviarla a mano. */
  async enviarEnlace(id: number, op: OperadorSesion, ip: string | null) {
    const c = await this.centro(id);
    if (!EDITABLE_CENTRO.includes(c.estado)) throw new UnprocessableEntityException({ mensaje: 'El enlace de fase 2 se envia despues de la reunion (REUNION o DATOS_COMPLETOS)' });
    if (!c.slug) throw new UnprocessableEntityException({ mensaje: 'Primero define el slug del centro' });
    const token = randomBytes(32).toString('base64url');
    const venceEn = new Date(Date.now() + DIAS_ENLACE * 86_400_000);
    const ahora = new Date();
    const nuevo = await this.prisma.$transaction(async (tx) => {
      await tx.enlaceFase2.updateMany({ where: { centroId: id, revocadoEn: null }, data: { revocadoEn: ahora } });
      return tx.enlaceFase2.create({ data: { centroId: id, tokenHash: hash(token), enviadoA: c.contactoCorreo, venceEn } });
    });
    const url = `${this.sitioUrl}/manifiesto/${token}`;
    try {
      await this.correo.enviarEnlaceFase2(c.contactoCorreo, c.nombre, url, DIAS_ENLACE);
    } catch (e) {
      await this.prisma.enlaceFase2.delete({ where: { id: nuevo.id } });
      throw e;
    }
    await this.auditoria.registrar(op.correo, 'centro.enlace_fase2', `centro:${id}`, `enviado a ${c.contactoCorreo}; vence ${venceEn.toISOString().slice(0, 10)}${ip ? ` · ${ip}` : ''}`);
    return { url, venceEn };
  }

  async revocarEnlace(id: number, op: OperadorSesion, ip: string | null) {
    await this.centro(id);
    const r = await this.prisma.enlaceFase2.updateMany({ where: { centroId: id, revocadoEn: null }, data: { revocadoEn: new Date() } });
    if (r.count) await this.auditoria.registrar(op.correo, 'centro.enlace_revocado', `centro:${id}`, ip);
  }

  /** El operador guarda el borrador completo (todos los campos). Nueva revision fase 2 si cambio. */
  async guardarPorOperador(id: number, cuerpo: unknown, op: OperadorSesion, ip: string | null) {
    const c = await this.centro(id);
    this.exigirAntesDeAprobado(c.estado);
    const r = borradorSchema.safeParse(cuerpo);
    if (!r.success) throw new BadRequestException({ mensaje: `Revisa ${r.error.issues[0].path.join('.')}: ${r.error.issues[0].message}` });
    const rev = await guardarRevision(this.prisma, id, 2, r.data, op.correo);
    if (rev.nueva) await this.auditoria.registrar(op.correo, 'centro.manifiesto', `centro:${id}`, `rev ${rev.numero} · sha ${rev.hash.slice(0, 12)}${ip ? ` · ${ip}` : ''}`);
    return { ...rev, p0: validarP0(r.data, c.slug) };
  }

  /** DATOS_COMPLETOS -> APROBADO: P0 ok (incluye contrato firmado y modulos del MVP). Congela el manifiesto en una revision fase 3. */
  async aprobar(id: number, op: OperadorSesion, ip: string | null) {
    const c = await this.centro(id);
    if (c.estado !== 'DATOS_COMPLETOS') throw new UnprocessableEntityException({ mensaje: 'Solo se aprueba desde DATOS_COMPLETOS' });
    const { borrador } = await leerBorrador(this.prisma, id);
    const p0 = validarP0(borrador, c.slug);
    if (!p0.ok || !p0.manifiesto) throw new UnprocessableEntityException({ mensaje: 'P0 con errores', errores: p0.errores });
    const ahora = new Date();
    const rev = await this.prisma.$transaction(async (tx) => {
      const r = await guardarRevision(tx, id, 3, p0.manifiesto, op.correo);
      const u = await tx.centro.updateMany({
        where: { id, estado: 'DATOS_COMPLETOS', slug: c.slug },
        data: { estado: 'APROBADO', revisionAprobada: r.numero, hashAprobado: r.hash, aprobadoEn: ahora },
      });
      if (u.count !== 1) throw new ConflictException({ mensaje: 'El centro cambio mientras tanto. Recarga.' });
      await tx.transicionCentro.create({ data: { centroId: id, desde: 'DATOS_COMPLETOS', hacia: 'APROBADO', actor: op.correo, motivo: `rev ${r.numero} · sha ${r.hash.slice(0, 12)}` } });
      await tx.enlaceFase2.updateMany({ where: { centroId: id, revocadoEn: null }, data: { revocadoEn: ahora } });
      return r;
    });
    await this.auditoria.registrar(op.correo, 'centro.aprobado', `centro:${id}`, `rev ${rev.numero} · sha ${rev.hash}${ip ? ` · ${ip}` : ''}`);
    return { revision: rev.numero, hash: rev.hash };
  }

  // ---------- lado del centro (enlace privado, via apps/sitio) ----------

  private async porToken(token: string) {
    const e = await this.prisma.enlaceFase2.findUnique({ where: { tokenHash: hash(token) }, include: { centro: true } });
    if (!e || e.revocadoEn || e.venceEn <= new Date()) throw new GoneException({ mensaje: 'Este enlace ya no es valido. Pide uno nuevo a Vinculos.' });
    return e;
  }

  async abrir(token: string) {
    const e = await this.porToken(token);
    await this.prisma.enlaceFase2.update({ where: { id: e.id }, data: { ultimoUsoEn: new Date() } });
    const { borrador } = await leerBorrador(this.prisma, e.centroId);
    return {
      nombre: e.centro.nombre,
      estado: e.centro.estado,
      editable: EDITABLE_CENTRO.includes(e.centro.estado),
      enviado: e.centro.estado === 'DATOS_COMPLETOS',
      venceEn: e.venceEn,
      subdominioSugerido: `${e.centro.slug}.${this.dominioBase}`,
      borrador: parteCentro(borrador),
    };
  }

  async guardarPorCentro(token: string, cuerpo: unknown) {
    const e = await this.porToken(token);
    if (!EDITABLE_CENTRO.includes(e.centro.estado)) throw new UnprocessableEntityException({ mensaje: 'El manifiesto ya no se puede editar' });
    const r = borradorCentroSchema.safeParse(cuerpo);
    if (!r.success) throw new BadRequestException({ mensaje: `Revisa ${r.error.issues[0].path.join('.')}: ${r.error.issues[0].message}` });
    const { borrador } = await leerBorrador(this.prisma, e.centroId);
    const rev = await guardarRevision(this.prisma, e.centroId, 2, mezclarBorradorCentro(borrador, r.data), 'centro:enlace');
    if (rev.nueva) await this.auditoria.registrar('centro:enlace', 'centro.manifiesto', `centro:${e.centroId}`, `rev ${rev.numero} · sha ${rev.hash.slice(0, 12)}`);
    return { guardado: true };
  }

  /** El centro envia sus datos: si estan completos, REUNION -> DATOS_COMPLETOS. */
  async enviarPorCentro(token: string) {
    const e = await this.porToken(token);
    if (!EDITABLE_CENTRO.includes(e.centro.estado)) throw new UnprocessableEntityException({ mensaje: 'El manifiesto ya no se puede editar' });
    const { borrador } = await leerBorrador(this.prisma, e.centroId);
    const r = datosCentroSchema.safeParse(parteCentro(borrador));
    if (!r.success) throw new UnprocessableEntityException({ mensaje: 'Faltan datos', campos: r.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })) });
    if (e.centro.estado === 'REUNION') {
      await this.prisma.$transaction(async (tx) => {
        const u = await tx.centro.updateMany({ where: { id: e.centroId, estado: 'REUNION' }, data: { estado: 'DATOS_COMPLETOS' } });
        if (u.count === 1) await tx.transicionCentro.create({ data: { centroId: e.centroId, desde: 'REUNION', hacia: 'DATOS_COMPLETOS', actor: 'centro:enlace' } });
      });
      await this.auditoria.registrar('centro:enlace', 'centro.transicion', `centro:${e.centroId}`, 'REUNION -> DATOS_COMPLETOS');
    }
    return { enviado: true };
  }
}
