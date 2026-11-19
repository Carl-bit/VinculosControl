import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Job } from '@prisma/client';
import { manifiestoSchema } from '@vinculos/manifest';

import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../comun/prisma.service';
import { ReleasesService } from '../releases/releases.service';
import type { Canal } from '../releases/semver';
import { SalidasCierre } from '../salidas/cierre.service';

/**
 * Partes del job APROVISIONAR que corren en el plano de control (CONTEXTO.md
 * seccion 5): lo que P0 agrega al manifiesto, P1 (reservar), los datos que el
 * agente trae de P2 (version y digests), las confirmaciones manuales (P5
 * llaves, P8 dominio) y el cierre o la cancelacion.
 *
 * Reglas que vienen del ejecutor del host B (apps/ejecutor/src/aprovisionar.ts):
 * se validan aqui tambien para que el job falle en P0 y no en P2.
 */
export const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/;
export const NOMBRE_SILO = /^[\p{L}\p{N} .,'&()-]{2,120}$/u;
export const TEMAS_EJECUTOR = ['moderno', 'cuaderno'];
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** Estados del centro desde los que corre (APROVISIONANDO: reintento del mismo job). */
export const PARA_APROVISIONAR = ['APROBADO', 'APROVISIONANDO'];

export interface DatosP2 {
  version: string;
  apiDigest: string;
  webDigest: string;
}

type Res = { ok: boolean; log: string[]; error: string | null };

@Injectable()
export class AprovisionarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly cierre: SalidasCierre,
    private readonly releases: ReleasesService,
  ) {}

  /** P0 (ademas de schema, dependencias y hash): version fija, nombre y tema aceptados, slug y dominio libres. */
  async p0(job: Job, contenido: unknown): Promise<Res> {
    const log: string[] = [];
    const no = (error: string) => ({ ok: false, log, error });
    const c = await this.prisma.centro.findUniqueOrThrow({ where: { id: job.centroId! } });
    if (!PARA_APROVISIONAR.includes(c.estado)) return no(`El centro esta ${c.estado}: se aprovisiona desde APROBADO`);
    const m = manifiestoSchema.parse(contenido);
    // Version: la fija del manifiesto, o la ultima promovida a su canal (releases, seccion 7).
    // Queda en job.referencia: un reintento no cambia de version a mitad de camino.
    let version = job.referencia;
    if (!version) {
      if ('fija' in m.version) {
        version = m.version.fija;
      } else {
        const r = await this.releases.deCanal(m.version.canal as Canal);
        if (!r)
          return no(
            `No hay una version promovida al canal ${m.version.canal}: promover una en Releases${m.version.canal === 'estable' ? ' (una version de prueba, con sufijo, no llega a estable: usar canal demo o beta en el manifiesto, o publicar X.Y.Z)' : ''}`,
          );
        version = r.version;
      }
      await this.prisma.job.update({ where: { id: job.id }, data: { referencia: version } });
      job.referencia = version;
    }
    if (!VERSION.test(version)) return no(`Version invalida: ${version}`);
    const rel = await this.prisma.release.findUnique({ where: { version } });
    if (rel?.conflicto) return no(`La version ${version} tiene un conflicto de digests`);
    log.push('fija' in m.version ? `version fija ${version}` : `canal ${m.version.canal}: ${version}`);
    if (!NOMBRE_SILO.test(m.centro.nombre)) return no('El nombre del centro solo admite letras, numeros, espacio y . , \' & ( ) - (2 a 120)');
    const tema = m.estilo?.tema ?? 'moderno';
    if (!TEMAS_EJECUTOR.includes(tema)) return no(`Tema ${tema} no disponible en el ERP`);
    log.push(`tema ${tema}`);

    const slug = job.siloSlug!;
    const silo = await this.prisma.silo.findUnique({ where: { slug } });
    // Un erp-<slug> que el agente ya reporta y que no nacio de un aprovisionamiento de este centro: otro stack.
    // (Tras un job cancelado el stack queda y se reutiliza; el ejecutor ademas rechaza un stack sin su .env.)
    if (silo?.vistoEn) {
      const previo = await this.prisma.job.findFirst({ where: { tipo: 'APROVISIONAR', centroId: c.id, NOT: { id: job.id } }, select: { id: true } });
      if (!previo && c.estado === 'APROBADO') return no(`El agente ya reporta un stack erp-${slug} en el host B`);
    }
    const ocupado = await this.prisma.silo.findFirst({ where: { dominio: m.dominio.valor, NOT: { slug } }, select: { slug: true } });
    if (ocupado) return no(`El dominio ${m.dominio.valor} ya es del silo ${ocupado.slug}`);
    log.push(`slug erp-${slug} y dominio ${m.dominio.valor} libres`);
    return { ok: true, log, error: null };
  }

  /** P1: centro APROVISIONANDO (una vez) y registro del silo (no adoptado hasta el cierre: sin alertas a medio camino). */
  async p1(job: Job, contenido: unknown): Promise<Res> {
    const m = manifiestoSchema.parse(contenido);
    const c = await this.prisma.centro.findUniqueOrThrow({ where: { id: job.centroId! } });
    const log: string[] = [];
    if (c.estado === 'APROBADO') {
      await this.cierre.transitar(c.id, 'APROBADO', 'APROVISIONANDO', `job:${job.id}`, `aprovisionar rev ${job.revision}`, async () => undefined);
      log.push('centro APROBADO -> APROVISIONANDO');
    } else if (c.estado === 'APROVISIONANDO') {
      log.push('centro ya APROVISIONANDO');
    } else {
      return { ok: false, log, error: `El centro esta ${c.estado}` };
    }
    await this.prisma.silo.upsert({
      where: { slug: job.siloSlug! },
      create: { slug: job.siloSlug!, dominio: m.dominio.valor },
      update: { dominio: m.dominio.valor },
    });
    log.push(`silo erp-${job.siloSlug} registrado (${m.dominio.valor})`);
    return { ok: true, log, error: null };
  }

  /** P2 OK: version y digests que preparo el ejecutor. */
  async guardarDatosP2(job: Job, d: DatosP2) {
    if (!VERSION.test(d.version) || !DIGEST.test(d.apiDigest) || !DIGEST.test(d.webDigest)) throw new UnprocessableEntityException({ mensaje: 'Datos de imagen invalidos' });
    // La version que resolvio P0 (fija o la del canal) es la unica aceptada.
    if (job.referencia !== d.version) throw new UnprocessableEntityException({ mensaje: `El ejecutor preparo ${d.version} y el job pide ${job.referencia ?? '?'}` });
    await this.prisma.silo.update({ where: { slug: job.siloSlug! }, data: { version: d.version, apiDigest: d.apiDigest, webDigest: d.webDigest } });
  }

  /** Job OK (P10): centro ACTIVO, silo adoptado (entra al monitoreo y a las alertas). */
  async alTerminar(job: Job) {
    const c = await this.prisma.centro.findUniqueOrThrow({ where: { id: job.centroId! } });
    if (c.estado !== 'APROVISIONANDO') return;
    const silo = await this.prisma.silo.findUniqueOrThrow({ where: { slug: job.siloSlug! } });
    await this.cierre.transitar(c.id, 'APROVISIONANDO', 'ACTIVO', `job:${job.id}`, `aprovisionado: ${silo.version ?? '?'} api ${silo.apiDigest?.slice(7, 19) ?? '?'} web ${silo.webDigest?.slice(7, 19) ?? '?'}`, (tx) =>
      tx.silo.update({ where: { slug: silo.slug }, data: { adoptado: true, adoptadoEn: new Date() } }),
    );
    await this.auditoria.registrar(`job:${job.id}`, 'centro.activo', `centro:${c.id}`, `erp-${silo.slug} ${silo.version} rev ${job.revision}`);
  }

  /**
   * Job cancelado: el centro vuelve a APROBADO. Lo creado en el host B (stack,
   * .env, token) queda: reintentar un job nuevo lo reutiliza (preparar conserva
   * los secretos). Nunca se borra nada automaticamente.
   */
  async alCancelar(job: Job, actor: string) {
    const c = await this.prisma.centro.findUnique({ where: { id: job.centroId! } });
    if (c?.estado !== 'APROVISIONANDO') return;
    await this.cierre.transitar(c.id, 'APROVISIONANDO', 'APROBADO', actor, `job:${job.id} cancelado; lo creado en el host B queda para el siguiente intento`, async () => undefined);
  }
}
