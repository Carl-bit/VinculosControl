/**
 * Releases del host B (CONTEXTO.md seccion 7): el agente lee
 * infra/imagenes/<version>.env del ERP (los escribe publicar.sh, montado en
 * solo lectura) y se los informa al plano de control. Solo version, digests,
 * commit y fecha: nada mas sale del archivo.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = process.env.IMAGENES_DIR ?? '';
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface ReleaseHost {
  version: string;
  apiDigest: string;
  webDigest: string;
  commit: string;
  publicada: string;
}

/** Un <version>.env de publicar.sh, o null si no tiene la forma esperada. */
export function leerRelease(nombre: string, texto: string): ReleaseHost | null {
  const v: Record<string, string> = {};
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(linea);
    if (m) v[m[1]] = m[2].trim();
  }
  const version = nombre.replace(/\.env$/, '');
  if (!VERSION.test(version) || v.VINCULOS_VERSION !== version) return null;
  if (!DIGEST.test(v.API_DIGEST ?? '') || !DIGEST.test(v.WEB_DIGEST ?? '')) return null;
  if (!/^[0-9a-f]{7,40}(-sucio)?$/.test(v.VINCULOS_COMMIT ?? '') || Number.isNaN(Date.parse(v.VINCULOS_PUBLICADO ?? ''))) return null;
  return { version, apiDigest: v.API_DIGEST, webDigest: v.WEB_DIGEST, commit: v.VINCULOS_COMMIT, publicada: v.VINCULOS_PUBLICADO };
}

export async function releasesDelHost(dir = DIR): Promise<ReleaseHost[]> {
  if (!dir) return [];
  const nombres = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.env'));
  const lista = await Promise.all(nombres.map(async (n) => leerRelease(n, await readFile(join(dir, n), 'utf8').catch(() => ''))));
  return lista.filter((r): r is ReleaseHost => r !== null);
}

type Post = (ruta: string, cuerpo: unknown) => Promise<Response>;

/** Informa los releases del host B. Devuelve cuantos leyo. */
export async function informarReleases(post: Post, dir = DIR): Promise<string> {
  const releases = await releasesDelHost(dir);
  if (!releases.length) return '0';
  const r = await post('releases', { releases });
  if (!r.ok) throw new Error(`releases: HTTP ${r.status}`);
  const { nuevas, conflictos } = (await r.json()) as { nuevas: number; conflictos: number };
  return `${releases.length} (${nuevas} nuevas${conflictos ? `, ${conflictos} CONFLICTO` : ''})`;
}
