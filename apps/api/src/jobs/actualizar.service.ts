import { Injectable } from '@nestjs/common';
import type { Job } from '@prisma/client';

import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../comun/prisma.service';
import { ExportacionesService } from '../exportaciones/exportaciones.controller';
import { ReleasesService } from '../releases/releases.service';
import { type Canal, CANALES, compararVersion, tipoSalto } from '../releases/semver';
import { enVentanaRespaldo } from './pasos';

/** Estados del centro cuyo silo se actualiza. */
export const PARA_ACTUALIZAR = ['ACTIVO', 'ACTIVO_SIN_DOMINIO'];

type Res = { ok: boolean; log: string[]; error: string | null };

/**
 * Partes de ACTUALIZAR que corren en el plano de control (CONTEXTO.md seccion 7):
 * U0, a que canal pertenece un silo, que silos entran en una cascada y el
 * cierre (el silo guarda la version y los digests que corre).
 */
@Injectable()
export class ActualizarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly releases: ReleasesService,
    private readonly exportaciones: ExportacionesService,
  ) {}

  /** Canal del silo segun la revision aprobada de su centro (fija = el silo no se mueve). */
  async canalDe(slug: string): Promise<{ centroId: number; revision: number; hash: string; estado: string; canal: Canal | null; fija: string | null } | null> {
    const c = await this.prisma.centro.findUnique({ where: { slug } });
    if (!c?.revisionAprobada || !c.hashAprobado) return null;
    const rev = await this.prisma.revisionManifiesto.findUnique({ where: { centroId_numero: { centroId: c.id, numero: c.revisionAprobada } } });
    const v = (rev?.contenido as { version?: { canal?: string; fija?: string } } | null)?.version ?? {};
    const canal = (CANALES as readonly string[]).includes(v.canal ?? '') ? (v.canal as Canal) : null;
    return { centroId: c.id, revision: c.revisionAprobada, hash: c.hashAprobado, estado: c.estado, canal, fija: v.fija ?? null };
  }

  /** U0: version promovida al canal del silo, posterior a la que corre y sin conflicto. Se repite al reintentar. */
  async p0(job: Job): Promise<Res> {
    const slug = job.siloSlug!;
    const version = job.referencia ?? '';
    const log = [`erp-${slug} -> ${version}`];
    const no = (error: string) => ({ ok: false, log, error });
    const silo = await this.prisma.silo.findUnique({ where: { slug } });
    if (!silo?.adoptado) return no('El silo no esta adoptado (aprovisionado y en monitoreo)');
    if (!silo.version) return no('El silo no registra la version que corre');
    if (!silo.vistoEn || Date.now() - silo.vistoEn.getTime() > 10 * 60_000) return no('El agente no reporta este silo hace mas de 10 min');
    if (enVentanaRespaldo(new Date())) return no('Ventana de respaldo (01:45 a 02:30 Chile): intenta despues');
    // R13: con un exporte del centro pendiente o en proceso no se actualiza (se repite al reintentar).
    const exp = await this.exportaciones.estado(slug);
    if (exp.enCurso) return no(`El centro tiene una exportacion ${exp.enCurso.estado} (creada ${exp.enCurso.creadaEn.toISOString()}): se actualiza al terminar`);
    log.push(exp.informa ? 'sin exportacion en curso (informado por el silo, R13)' : 'el silo no informa R13: vale la confirmacion del operador');
    const c = await this.canalDe(slug);
    if (!c) return no('El centro del silo no tiene manifiesto aprobado');
    if (!PARA_ACTUALIZAR.includes(c.estado)) return no(`El centro esta ${c.estado}: se actualiza un silo activo`);
    if (!c.canal) return no(`El manifiesto fija la version ${c.fija ?? '?'}: el silo no se mueve hasta cambiar el manifiesto`);
    const r = await this.prisma.release.findUnique({ where: { version } });
    if (!r) return no(`No existe la version ${version}`);
    if (r.conflicto) return no(`La version ${version} tiene un conflicto de digests`);
    if (!this.releases.enCanal(r, c.canal)) return no(`La version ${version} no esta promovida al canal ${c.canal}`);
    if (compararVersion(version, silo.version) <= 0) return no(`El silo ya corre ${silo.version}: solo se actualiza hacia adelante (la vuelta atras es automatica si falla)`);
    log.push(`canal ${c.canal}`, `${silo.version} -> ${version} (${tipoSalto(silo.version, version)})`, 'silo reportado y fuera de la ventana de respaldo');
    return { ok: true, log, error: null };
  }

  /** Silos de un canal que estan por debajo de una version, en orden (la cascada va uno a la vez). */
  async silosDeCanal(canal: Canal, version: string): Promise<string[]> {
    const silos = await this.prisma.silo.findMany({ where: { adoptado: true, version: { not: null } }, orderBy: { slug: 'asc' } });
    const out: string[] = [];
    for (const s of silos) {
      const c = await this.canalDe(s.slug);
      if (c?.canal === canal && PARA_ACTUALIZAR.includes(c.estado) && compararVersion(version, s.version!) > 0) out.push(s.slug);
    }
    return out;
  }

  /** Para la consola (detalle del silo): version que corre, su canal y a que versiones puede subir. */
  async opciones(slug: string) {
    const silo = await this.prisma.silo.findUnique({ where: { slug } });
    const c = await this.canalDe(slug);
    const releases = await this.prisma.release.findMany({ where: { conflicto: null } });
    const disponibles =
      silo?.version && c?.canal
        ? releases
            .filter((r) => this.releases.enCanal(r, c.canal!) && compararVersion(r.version, silo.version!) > 0)
            .sort((a, b) => compararVersion(b.version, a.version))
            .map((r) => ({ version: r.version, salto: tipoSalto(silo.version!, r.version) }))
        : [];
    return {
      version: silo?.version ?? null,
      apiDigest: silo?.apiDigest ?? null,
      webDigest: silo?.webDigest ?? null,
      canal: c?.canal ?? null,
      fija: c?.fija ?? null,
      estadoCentro: c?.estado ?? null,
      disponibles,
      exportes: await this.exportaciones.estado(slug),
    };
  }

  /** Job OK: el silo registra la version y los digests que corre ahora. */
  async alTerminar(job: Job) {
    const r = await this.prisma.release.findUniqueOrThrow({ where: { version: job.referencia! } });
    const antes = await this.prisma.silo.findUniqueOrThrow({ where: { slug: job.siloSlug! } });
    await this.prisma.silo.update({ where: { slug: job.siloSlug! }, data: { version: r.version, apiDigest: r.apiDigest, webDigest: r.webDigest } });
    await this.auditoria.registrar(`job:${job.id}`, 'silo.actualizado', `silo:${job.siloSlug}`, `${antes.version ?? '?'} -> ${r.version} api ${r.apiDigest.slice(7, 19)} web ${r.webDigest.slice(7, 19)}`);
  }
}
