/**
 * Verbos del job ACTUALIZAR (CONTEXTO.md seccion 7; decisiones del usuario
 * 2026-11-15). Un silo a la vez: respaldo -> imagen nueva -> migrate -> recrear
 * backend y frontend -> /api/salud -> volver a la imagen anterior si falla.
 *
 *   respaldar(slug)            pg_dump del silo cifrado igual que respaldar.sh del
 *                              ERP (openssl enc aes-256-cbc, pbkdf2, 200000 iter), en
 *                              respaldos/<slug>/ con su .sha256. El cifrado corre en
 *                              un contenedor auxiliar efimero, sin red, que monta SOLO
 *                              secrets/<slug>/respaldo.key en solo lectura: el ejecutor
 *                              nunca lee la llave (ni la KEK ni las partes). Si pg_dump u
 *                              openssl fallan, no queda archivo (corrige R14).
 *   actualizar(slug, version)  cambia en el .env las 4 lineas de imagen (version,
 *                              registro, digests) por las de imagenes/<version>.env,
 *                              guardando las anteriores en anterior.env. No toca
 *                              secretos ni levanta nada (eso es levantar bd / todo).
 *   revertir(slug)             vuelve a las lineas de anterior.env y recrea solo
 *                              backend y frontend (sin migrate: las migraciones son
 *                              aditivas, la imagen anterior corre sobre la BD nueva).
 */
import { type Compose, type Config, type DiscoSilos, type DockerApr, imagenesDe, leerVariables, MARCA, validarCompose, VERSION } from './aprovisionar';
import { enVentanaRespaldo, ErrorVerbo, validarSlug } from './verbos';

export const LINEAS_IMAGEN = ['VINCULOS_VERSION', 'REGISTRO', 'API_DIGEST', 'WEB_DIGEST'] as const;

/** Archivos extra de ACTUALIZAR (inyectable para los tests). */
export interface DiscoActualizar extends DiscoSilos {
  leerAnterior(slug: string): Promise<string | null>;
  escribirAnterior(slug: string, contenido: string): Promise<void>;
}

/** pg_dump | openssl hacia respaldos/<slug>/<archivo>: todo o nada. */
export interface Tuberia {
  respaldar(slug: string, archivo: string): Promise<{ bytes: number; sha256: string } | { error: string }>;
}

const proyecto = (slug: string) => `erp-${slug}`;

/** Reemplaza (o agrega) las lineas KEY=valor indicadas, sin tocar el resto del .env. */
export function reemplazarLineas(env: string, valores: Partial<Record<(typeof LINEAS_IMAGEN)[number], string>>): string {
  let out = env;
  for (const [k, v] of Object.entries(valores)) {
    if (v === undefined) continue;
    const re = new RegExp(`^${k}=.*$`, 'm');
    out = re.test(out) ? out.replace(re, `${k}=${v}`) : `${out.replace(/\n?$/, '\n')}${k}=${v}\n`;
  }
  return out;
}

async function envDelEjecutor(disco: DiscoSilos, slug: string): Promise<string> {
  const env = await disco.leerEnv(slug);
  if (env === null || !env.startsWith(MARCA)) throw new ErrorVerbo(409, `${proyecto(slug)} no lo aprovisiono el ejecutor: no se actualiza por aqui`);
  return env;
}

export function validarVersion(p: unknown): string {
  const o = (p ?? {}) as Record<string, unknown>;
  if (Object.keys(o).length !== 1 || typeof o.version !== 'string' || !VERSION.test(o.version)) throw new ErrorVerbo(400, 'se espera { version: "X.Y.Z" }');
  return o.version;
}

/** Nombre del respaldo, mismo formato que respaldar.sh: <slug>-AAAAMMDDTHHMMSSZ.dump.enc */
export const nombreRespaldo = (slug: string, ahora: Date) => `${slug}-${ahora.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}.dump.enc`;

export async function respaldar(disco: DiscoSilos, t: Tuberia, slug: string, ahora = new Date(), demo = false) {
  validarSlug(slug);
  if (enVentanaRespaldo(ahora)) throw new ErrorVerbo(409, 'ventana de respaldo (01:45 a 02:30 Chile): el respaldo diario ya corre; intenta despues');
  await envDelEjecutor(disco, slug);
  // Demo (EJECUTOR_DEMOS con ES_DEMO=true; 2026-11-19): sin respaldo.key ni respaldo, igual que P9. Datos ficticios de 24 h.
  if (demo) return { log: ['demo: sin respaldo (datos ficticios; P9 omitido)'] };
  const archivo = nombreRespaldo(slug, ahora);
  const r = await t.respaldar(slug, archivo);
  if ('error' in r) {
    if (/bind source path does not exist: \S*\/secrets\//.test(r.error)) throw new ErrorVerbo(409, `falta secrets/${slug}/respaldo.key: el operador corre respaldo-silo una vez (P9)`);
    throw new ErrorVerbo(500, `respaldo de ${slug} fallido, no quedo archivo: ${r.error.slice(-300)}`);
  }
  // Un pg_dump real de un silo vacio ya supera 1 KB; menos es un respaldo roto (R14).
  if (r.bytes < 1024) throw new ErrorVerbo(500, `respaldo de ${slug} demasiado chico (${r.bytes} bytes)`);
  return { log: [`respaldo ${archivo} (${r.bytes} bytes)`, `sha256 ${r.sha256.slice(0, 12)}`], respaldo: { archivo, bytes: r.bytes, sha256: r.sha256 } };
}

export async function actualizar(d: DockerApr, disco: DiscoActualizar, c: Compose, cfg: Config, slug: string, version: string, ahora = new Date()) {
  validarSlug(slug);
  if (enVentanaRespaldo(ahora)) throw new ErrorVerbo(409, 'ventana de respaldo (01:45 a 02:30 Chile): intenta despues');
  const env = await envDelEjecutor(disco, slug);
  if (!(await d.listar(proyecto(slug))).length) throw new ErrorVerbo(409, `${proyecto(slug)} no tiene contenedores: un silo nuevo se aprovisiona (preparar)`);

  const texto = await disco.leerImagenes(version);
  if (texto === null) throw new ErrorVerbo(404, `no hay imagenes/${version}.env: publicar la version en el host B (publicar.sh)`);
  const img = imagenesDe(texto, version, cfg.registro);
  for (const ref of [img.api, img.web]) {
    if (!(await d.existeEnRegistro(ref))) throw new ErrorVerbo(409, `el registro no tiene ${ref}`);
  }
  const previas = leerVariables(env);
  const log = [`imagenes ${version}: ${img.apiDigest.slice(0, 19)}, ${img.webDigest.slice(0, 19)}`];
  const yaEsta = previas.VINCULOS_VERSION === version && previas.API_DIGEST === img.apiDigest && previas.WEB_DIGEST === img.webDigest;
  if (yaEsta) {
    // Reintento: el .env ya apunta a la version nueva; anterior.env conserva la de antes.
    log.push(`.env ya en ${version} (anterior.env sin cambios)`);
  } else {
    await disco.escribirAnterior(slug, `${LINEAS_IMAGEN.map((k) => `${k}=${previas[k] ?? ''}`).join('\n')}\n`);
    await disco.escribirEnv(slug, reemplazarLineas(env, { VINCULOS_VERSION: version, REGISTRO: cfg.registro, API_DIGEST: img.apiDigest, WEB_DIGEST: img.webDigest }));
    log.push(`.env: ${previas.VINCULOS_VERSION ?? '?'} -> ${version} (anterior.env guardado; secretos sin cambios)`);
  }
  log.push(await validarCompose(c, cfg, slug, img));
  return { log, imagenes: { version, apiDigest: img.apiDigest, webDigest: img.webDigest }, anterior: yaEsta ? null : (previas.VINCULOS_VERSION ?? null) };
}

export async function revertir(disco: DiscoActualizar, c: Compose, cfg: Config, slug: string, argsCompose: (cfg: Config, slug: string) => string[]) {
  validarSlug(slug);
  const env = await envDelEjecutor(disco, slug);
  const anterior = await disco.leerAnterior(slug);
  if (anterior === null) throw new ErrorVerbo(409, `${proyecto(slug)} no tiene anterior.env: no hay a que volver`);
  const a = leerVariables(anterior);
  if (!a.VINCULOS_VERSION || !a.API_DIGEST || !a.WEB_DIGEST || !a.REGISTRO) throw new ErrorVerbo(500, 'anterior.env incompleto');
  await disco.escribirEnv(slug, reemplazarLineas(env, { VINCULOS_VERSION: a.VINCULOS_VERSION, REGISTRO: a.REGISTRO, API_DIGEST: a.API_DIGEST, WEB_DIGEST: a.WEB_DIGEST }));
  const log = [`.env de vuelta en ${a.VINCULOS_VERSION}`];
  const base = argsCompose(cfg, slug);
  const up = await c.correr([...base, 'up', '-d', '--no-build', '--no-deps', '--pull', 'missing', '--quiet-pull', 'backend', 'frontend'], 15 * 60_000);
  if (up.codigo !== 0) throw new ErrorVerbo(500, `docker compose up (revertir): ${up.salida.slice(-300)}`);
  log.push(`backend y frontend recreados con ${a.VINCULOS_VERSION} (sin migrate: migraciones aditivas)`);
  return { log, imagenes: { version: a.VINCULOS_VERSION, apiDigest: a.API_DIGEST, webDigest: a.WEB_DIGEST } };
}
