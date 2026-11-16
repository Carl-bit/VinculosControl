import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Release } from '@prisma/client';

import type { OperadorSesion } from '../acceso/acceso.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../comun/prisma.service';
import { bloqueoPromocion, type Canal, CANALES, compararVersion, VERSION } from './semver';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CAMPO: Record<Canal, 'enDemoEn' | 'enBetaEn' | 'enEstableEn'> = { demo: 'enDemoEn', beta: 'enBetaEn', estable: 'enEstableEn' };

export interface ReleaseAgente {
  version: string;
  apiDigest: string;
  webDigest: string;
  commit: string;
  publicada: string;
}

/**
 * Releases (CONTEXTO.md seccion 7; decisiones del usuario 2026-11-15): los
 * detecta el agente en infra/imagenes/<version>.env del host B y el operador
 * los promueve demo -> beta -> estable. Tags inmutables: la misma version con
 * otros digests queda en conflicto y no se promueve ni se aplica.
 */
@Injectable()
export class ReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Lo que informa el agente. Idempotente: una version ya registrada con los mismos digests no cambia. */
  async registrar(agenteId: number, lista: ReleaseAgente[]) {
    let nuevas = 0;
    let conflictos = 0;
    for (const r of lista) {
      if (!VERSION.test(r.version) || !DIGEST.test(r.apiDigest) || !DIGEST.test(r.webDigest)) continue;
      const previa = await this.prisma.release.findUnique({ where: { version: r.version } });
      if (!previa) {
        await this.prisma.release.create({
          data: { version: r.version, apiDigest: r.apiDigest, webDigest: r.webDigest, commit: r.commit.slice(0, 60), publicadaEn: new Date(r.publicada) },
        });
        await this.auditoria.registrar(`agente:${agenteId}`, 'release.detectada', `release:${r.version}`, `api ${r.apiDigest.slice(7, 19)} web ${r.webDigest.slice(7, 19)}`);
        nuevas++;
      } else if ((previa.apiDigest !== r.apiDigest || previa.webDigest !== r.webDigest) && !previa.conflicto) {
        const conflicto = `el host B informa ${r.version} con otros digests (api ${r.apiDigest.slice(7, 19)}, web ${r.webDigest.slice(7, 19)}): un tag publicado no se reemplaza`;
        await this.prisma.release.update({ where: { version: r.version }, data: { conflicto } });
        await this.auditoria.registrar(`agente:${agenteId}`, 'release.conflicto', `release:${r.version}`, conflicto);
        conflictos++;
      }
    }
    return { nuevas, conflictos };
  }

  async listar() {
    const [releases, silos] = await Promise.all([this.prisma.release.findMany(), this.prisma.silo.findMany({ where: { adoptado: true }, select: { slug: true, version: true } })]);
    return releases
      .sort((a, b) => compararVersion(b.version, a.version))
      .map((r) => ({ ...r, silos: silos.filter((s) => s.version === r.version).map((s) => s.slug) }));
  }

  /** R6: notas de la version para el ADMIN (se entregan al actualizar cada silo). Editables; las ya entregadas no cambian en el silo. */
  async notas(version: string, texto: string, op: OperadorSesion, ip: string | null) {
    const r = await this.prisma.release.findUnique({ where: { version } });
    if (!r) throw new NotFoundException({ mensaje: `No existe la version ${version}` });
    const notas = texto.replace(/\r\n/g, '\n').trim() || null;
    if (notas === r.notas) return r;
    const out = await this.prisma.release.update({ where: { version }, data: { notas, notasEn: notas ? new Date() : null, notasPor: notas ? op.correo : null } });
    await this.auditoria.registrar(op.correo, 'release.notas', `release:${version}`, `${notas ? `${notas.length} caracteres` : 'borradas'}${ip ? ` · ${ip}` : ''}`);
    return out;
  }

  async promover(version: string, canal: Canal, op: OperadorSesion, ip: string | null) {
    if (!CANALES.includes(canal)) throw new UnprocessableEntityException({ mensaje: 'Canal invalido' });
    const r = await this.prisma.release.findUnique({ where: { version } });
    if (!r) throw new NotFoundException({ mensaje: `No existe la version ${version}` });
    if (r[CAMPO[canal]]) return r;
    const bloqueo = bloqueoPromocion(r, canal);
    if (bloqueo) throw new UnprocessableEntityException({ mensaje: bloqueo });
    const hecha = await this.prisma.release.update({ where: { version }, data: { [CAMPO[canal]]: new Date() } });
    await this.auditoria.registrar(op.correo, 'release.promovida', `release:${version}`, [canal, ip].filter(Boolean).join(' · '));
    return hecha;
  }

  /** Ultima version (semver) promovida a un canal, sin conflicto. */
  async deCanal(canal: Canal): Promise<Release | null> {
    const lista = await this.prisma.release.findMany({ where: { [CAMPO[canal]]: { not: null }, conflicto: null } });
    return lista.sort((a, b) => compararVersion(b.version, a.version))[0] ?? null;
  }

  enCanal = (r: Release, canal: Canal) => Boolean(r[CAMPO[canal]]);
}
