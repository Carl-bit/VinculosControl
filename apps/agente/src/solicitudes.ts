/**
 * Tarea 31 (R2/R3 del ERP): solicitudes de modulos que nacen en el silo.
 *
 * Por cada silo con token (TOKENS_INTERNOS_DIR/<slug>.token):
 *   1. R2: GET http://erp-<slug>-backend-1:3001/api/internal/solicitudes?desde=...
 *      por la red de borde del silo (el ejecutor une al agente con
 *      conectar_borde). Nunca por el tunel ni por Traefik (alli /api/internal da 403).
 *   2. POST /agente/solicitudes al plano de control (modelo pull: el agente llama).
 *   3. R3: POST .../solicitudes/:id/respuesta con cada decision por entregar.
 *      Si el silo la rechaza, el error viaja en el siguiente ciclo (fallidas).
 * Solo metadatos: modulo, accion, rol, fechas y estado (R2 no entrega motivo
 * ni quien la pidio).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = process.env.TOKENS_INTERNOS_DIR ?? '';
const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

export interface SolicitudR2 {
  id: string;
  modulo: string;
  accion: string;
  pedidaPorRol: string;
  pedidaEn: string;
  estado: string;
  respondidaEn: string | null;
  actualizadaEn: string;
}

type Post = (ruta: string, cuerpo: unknown) => Promise<Response>;
type Log = (msg: string) => void;

/** Ultima actualizadaEn vista por silo (al reiniciar el agente, vuelve a leer todo: hasta 500). */
const desdes = new Map<string, string>();
/** Errores de R3 del ciclo anterior, por silo. */
const fallidas = new Map<string, { id: string; error: string }[]>();

/**
 * URL de /api/internal del silo: por defecto el backend dentro de su red de
 * borde (nombre de contenedor de compose). SILO_INTERNO_URL la reemplaza con
 * {slug} como marcador; solo para desarrollo local, contra la API del ERP
 * corriendo fuera de Docker (http://host.docker.internal:3001/api/internal).
 */
const PLANTILLA = process.env.SILO_INTERNO_URL || 'http://erp-{slug}-backend-1:3001/api/internal';
export const urlSilo = (slug: string) => PLANTILLA.replaceAll('{slug}', slug);

export async function silosConToken(dir = DIR): Promise<{ slug: string; token: string }[]> {
  if (!dir) return [];
  const archivos = await readdir(dir).catch(() => [] as string[]);
  const silos = await Promise.all(
    archivos
      .filter((a) => a.endsWith('.token') && SLUG.test(a.slice(0, -6)))
      .map(async (a) => ({ slug: a.slice(0, -6), token: (await readFile(join(dir, a), 'utf8')).trim() })),
  );
  return silos.filter((s) => s.token.length >= 32);
}

async function llamarSilo<T>(slug: string, token: string, metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${urlSilo(slug)}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(15_000),
  }).catch((e: unknown) => {
    const causa = (e as { cause?: { code?: string } }).cause?.code;
    throw new Error(causa === 'ENOTFOUND' || causa === 'EAI_AGAIN' ? `erp-${slug}-backend-1 no resuelve: el agente no esta en erp-${slug}_borde (conectar_borde)` : String(e));
  });
  // El ERP responde sus errores con `mensaje` (core/errores); Nest por defecto, con `message`.
  const json = (await r.json().catch(() => ({}))) as T & { mensaje?: string | string[]; message?: string | string[] };
  if (!r.ok) throw new Error(`HTTP ${r.status} ${[json.mensaje ?? json.message].flat().join(' ').slice(0, 200)}`.trim());
  return json;
}

/** Un silo: R2 -> plano de control -> R3. Devuelve cuantas respuestas entrego. */
export async function sincronizarSilo(slug: string, token: string, post: Post, log: Log): Promise<number> {
  const desde = desdes.get(slug);
  const { solicitudes } = await llamarSilo<{ solicitudes: SolicitudR2[] }>(slug, token, 'GET', `/solicitudes${desde ? `?desde=${encodeURIComponent(desde)}` : ''}`);
  const r = await post('solicitudes', {
    slug,
    // Lista explicita: solo lo que acepta el plano de control (nada extra que agregue el silo).
    solicitudes: solicitudes.map(({ id, modulo, accion, pedidaPorRol, pedidaEn, estado }) => ({ id, modulo, accion, pedidaPorRol, pedidaEn, estado })),
    fallidas: fallidas.get(slug) ?? [],
  });
  if (!r.ok) throw new Error(`plano de control: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  fallidas.delete(slug);
  const { respuestas } = (await r.json()) as { respuestas: { id: string; estado: string; respuesta: string | null }[] };
  let entregadas = 0;
  const errores: { id: string; error: string }[] = [];
  for (const x of respuestas) {
    try {
      await llamarSilo(slug, token, 'POST', `/solicitudes/${x.id}/respuesta`, { estado: x.estado, ...(x.respuesta ? { respuesta: x.respuesta } : {}) });
      entregadas++;
    } catch (e) {
      errores.push({ id: x.id, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
      log(`solicitudes ${slug}: R3 ${x.id} fallo: ${errores.at(-1)!.error}`);
    }
  }
  if (errores.length) fallidas.set(slug, errores);
  const ultima = solicitudes.map((s) => s.actualizadaEn).sort().at(-1);
  if (ultima) desdes.set(slug, ultima);
  return entregadas;
}

export async function sincronizarSolicitudes(post: Post, log: Log): Promise<string> {
  const silos = await silosConToken();
  if (!silos.length) return 'sin silos con token interno';
  const partes: string[] = [];
  for (const { slug, token } of silos) {
    try {
      const n = await sincronizarSilo(slug, token, post, log);
      partes.push(`${slug} ok${n ? ` (${n} respuesta(s))` : ''}`);
    } catch (e) {
      partes.push(`${slug} error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return partes.join('; ');
}
