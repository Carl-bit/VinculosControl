/**
 * Verbos de aprovisionamiento (docs/propuesta-escritura-docker.md, opcion C,
 * etapa 2; CONTEXTO.md seccion 5). Habilitados por R1 (imagenes por digest).
 *
 *   preparar(slug, { version, dominio, nombre, tema })
 *     P0 (imagen): lee imagenes/<version>.env (lo escribe publicar.sh del ERP,
 *        montado en solo lectura) y pide al daemon que confirme en el registro
 *        los dos digests.
 *     P2: silos/<slug>/.env (600) con contrasenas de BD, JWT y token interno
 *        generados aqui (nunca viajan al plano de control); el token queda en
 *        tokens/<slug>.token para el agente y el silo guarda solo su SHA-256.
 *        En un reintento se conservan los secretos ya generados.
 *     P3: renderiza la plantilla del silo (silo.compose.tpl, dentro de la imagen
 *        del ejecutor) con las rutas del ERP en el host y la valida con
 *        `docker compose config`: solo postgres y vinculos-api/web por digest.
 *   levantar(slug, fase)
 *     bd   (P4): `up -d db migrate` y espera que migrate termine en 0.
 *     todo (P6): `up -d` del silo completo (la API arranca solo con la KEK que
 *          dejo el operador en P5). El borde lo une index.ts despues.
 *
 * Nunca: build, imagenes por tag, llaves (infra/secrets/ no se monta aqui: el
 * compose solo pasa la ruta al daemon), ni tocar un erp-<slug> que no creo el
 * ejecutor (los silos de prueba de servidor.sh, por ejemplo).
 */
import { createHash, randomBytes } from 'node:crypto';

import { type Contenedor, enVentanaRespaldo, ErrorVerbo, esSlugDemo, validarSlug } from './verbos';

export const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DOMINIO = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** Sin comillas, $, \ ni saltos de linea: va entre comillas dobles en el .env. */
const NOMBRE = /^[\p{L}\p{N} .,'&()-]{2,120}$/u;
export const TEMAS = ['moderno', 'cuaderno'] as const;
const REGISTRO = /^[a-z0-9.-]+(:[0-9]{2,5})?$/;
const RUTA_HOST = /^\/[A-Za-z0-9._/-]+$/;

/** Primera linea de todo .env que escribe el ejecutor: sin ella el silo no es suyo. */
export const MARCA = '# Generado por el ejecutor de Vinculos Control (preparar).';
/** Se generan una vez y se conservan en cada reintento. */
const SECRETOS = ['POSTGRES_PASSWORD', 'OWNER_DB_PASSWORD', 'APP_DB_PASSWORD', 'JWT_SECRET'] as const;

export interface Pedido {
  version: string;
  dominio: string;
  nombre: string;
  tema: string;
  /** El manifiesto aprobado es de demostracion (bloque demo). Lo decide el plano de control; el permiso lo da EJECUTOR_DEMOS. */
  demo?: boolean;
}

export interface Config {
  /** infra/ del repo del ERP tal como la ve el daemon (bind mounts y secrets del silo). */
  erpInfra: string;
  /** Registro del host B (EJECUTOR_REGISTRO); imagenes/<version>.env debe nombrar este. */
  registro: string;
  /** Carpeta de silos dentro del contenedor del ejecutor (compose corre aqui). */
  silosDir: string;
  smtpUrl: string;
  sesConfigurationSet: string;
}

/** Archivos que tocan estos verbos (inyectable para los tests). */
export interface DiscoSilos {
  plantilla(): Promise<string>;
  leerImagenes(version: string): Promise<string | null>;
  leerEnv(slug: string): Promise<string | null>;
  escribirEnv(slug: string, contenido: string): Promise<void>;
  escribirCompose(slug: string, contenido: string): Promise<void>;
  existeCompose(slug: string): Promise<boolean>;
  leerToken(slug: string): Promise<string | null>;
  escribirToken(slug: string, token: string): Promise<void>;
}

/** CLI de docker compose (sin shell; argumentos fijos armados aqui). */
export interface Compose {
  /** env: variables extra del proceso de compose (secretos que se pasan con -e NOMBRE, sin valor en los argumentos). */
  correr(args: string[], timeoutMs: number, env?: Record<string, string>): Promise<{ codigo: number; salida: string }>;
}

export interface DockerApr {
  listar(proyecto: string): Promise<Contenedor[]>;
  /** El daemon pregunta al registro por la referencia (GET /distribution/<ref>/json). */
  existeEnRegistro(ref: string): Promise<boolean>;
}

export function validarPedido(p: unknown): Pedido {
  const o = (p ?? {}) as Record<string, unknown>;
  const claves = Object.keys(o).sort().join(',');
  // `demo` es opcional: un agente anterior no lo manda (y entonces no se revisa en P2).
  if (claves !== 'dominio,nombre,tema,version' && claves !== 'demo,dominio,nombre,tema,version') throw new ErrorVerbo(400, 'se espera { version, dominio, nombre, tema, demo? }');
  if ('demo' in o && typeof o.demo !== 'boolean') throw new ErrorVerbo(400, 'demo debe ser true o false');
  const { version, dominio, nombre, tema } = o as Record<string, string>;
  if (typeof version !== 'string' || !VERSION.test(version)) throw new ErrorVerbo(400, 'version invalida');
  if (typeof dominio !== 'string' || !DOMINIO.test(dominio)) throw new ErrorVerbo(400, 'dominio invalido');
  if (typeof nombre !== 'string' || !NOMBRE.test(nombre)) throw new ErrorVerbo(400, 'nombre invalido (2 a 120: letras, numeros, espacio y . , \' & ( ) -)');
  if (typeof tema !== 'string' || !(TEMAS as readonly string[]).includes(tema)) throw new ErrorVerbo(400, `tema invalido (${TEMAS.join(', ')})`);
  return { version, dominio, nombre, tema, ...(typeof o.demo === 'boolean' ? { demo: o.demo } : {}) };
}

/**
 * P2: el manifiesto y la lista del host B deben coincidir antes de crear nada.
 * Un demo fuera de EJECUTOR_DEMOS fallaba recien en P10, despues de las llaves
 * y el respaldo manuales (hallazgo 2026-11-19); un centro real con un slug de la
 * lista quedaria marcado como demo.
 */
export function revisarDemo(pedido: Pedido, slug: string, demos: string[]): void {
  if (pedido.demo === undefined) return;
  const enLista = esSlugDemo(demos, slug);
  if (pedido.demo && !enLista)
    throw new ErrorVerbo(403, `${slug} es un demo pero no esta en EJECUTOR_DEMOS del host B: agregarlo en infra/host-b/.env, recrear el ejecutor (up -d ejecutor) y reintentar P2`);
  if (!pedido.demo && enLista) throw new ErrorVerbo(409, `${slug} esta en EJECUTOR_DEMOS pero su manifiesto no es de demostracion: sacarlo de la lista o usar otro slug`);
}

export function validarConfig(c: Config): Config {
  if (!RUTA_HOST.test(c.erpInfra) || c.erpInfra.includes('..')) throw new Error('EJECUTOR_ERP_INFRA: ruta absoluta del host invalida');
  if (!REGISTRO.test(c.registro)) throw new Error('EJECUTOR_REGISTRO invalido');
  if (!RUTA_HOST.test(c.silosDir)) throw new Error('EJECUTOR_SILOS_DIR invalido');
  if (/[\r\n"$\\]/.test(c.smtpUrl + c.sesConfigurationSet)) throw new Error('EJECUTOR_SMTP_URL o EJECUTOR_SES_CONFIGURATION_SET con caracteres no permitidos');
  return c;
}

/** KEY=VALUE de un .env (sin comillas ni interpolacion: solo lo que escribe publicar.sh o el ejecutor). */
export function leerVariables(texto: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(linea);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Imagenes de la version, desde imagenes/<version>.env (publicar.sh del ERP). */
export function imagenesDe(texto: string, version: string, registro: string) {
  const v = leerVariables(texto);
  if (v.VINCULOS_VERSION !== version) throw new ErrorVerbo(409, `imagenes/${version}.env no es de esa version`);
  if (v.REGISTRO !== registro) throw new ErrorVerbo(409, `imagenes/${version}.env apunta a ${v.REGISTRO ?? '?'}, no al registro del host (${registro})`);
  if (!DIGEST.test(v.API_DIGEST ?? '') || !DIGEST.test(v.WEB_DIGEST ?? '')) throw new ErrorVerbo(409, `imagenes/${version}.env sin digests validos`);
  return { api: `${registro}/vinculos-api@${v.API_DIGEST}`, web: `${registro}/vinculos-web@${v.WEB_DIGEST}`, apiDigest: v.API_DIGEST, webDigest: v.WEB_DIGEST };
}

/** Plantilla -> compose del silo: las rutas relativas al infra/ del ERP pasan a absolutas del host. */
export function renderizar(plantilla: string, erpInfra: string): string {
  const cuenta = (t: string) => plantilla.split(t).length - 1;
  if (cuenta('./postgres/init:') !== 1 || cuenta('./secrets/${CLIENTE_SLUG}/') !== 2 || /^\s+build:/m.test(plantilla)) {
    throw new ErrorVerbo(500, 'la plantilla del silo cambio de forma: regenerar el ejecutor');
  }
  return plantilla.replace('./postgres/init:', `${erpInfra}/postgres/init:`).split('./secrets/${CLIENTE_SLUG}/').join(`${erpInfra}/secrets/\${CLIENTE_SLUG}/`);
}

const azar = (bytes: number) => randomBytes(bytes).toString('hex');
export const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');

export function contenidoEnv(slug: string, p: Pedido, img: { apiDigest: string; webDigest: string }, cfg: Config, secretos: Record<string, string>, tokenHash: string, demo = false) {
  return [
    MARCA,
    '# Unico de este silo: nunca copiar a otro. Secretos generados en el host B; no salen de aqui.',
    `CLIENTE_SLUG=${slug}`,
    `CENTRO_NOMBRE="${p.nombre}"`,
    `DOMINIO=${p.dominio}`,
    `TEMA=${p.tema}`,
    '# Imagenes por digest (R1), de imagenes/<version>.env.',
    `VINCULOS_VERSION=${p.version}`,
    `REGISTRO=${cfg.registro}`,
    `API_DIGEST=${img.apiDigest}`,
    `WEB_DIGEST=${img.webDigest}`,
    'POSTGRES_USER=postgres',
    `POSTGRES_PASSWORD=${secretos.POSTGRES_PASSWORD}`,
    'POSTGRES_DB=app',
    `OWNER_DB_PASSWORD=${secretos.OWNER_DB_PASSWORD}`,
    `APP_DB_PASSWORD=${secretos.APP_DB_PASSWORD}`,
    `JWT_SECRET=${secretos.JWT_SECRET}`,
    '# Hash del token de /api/internal (el token esta en tokens/<slug>.token del agente).',
    `INTERNO_TOKEN_SHA256=${tokenHash}`,
    'LOGIN_LIMITE_POR_MINUTO=10',
    'PUBLICO_LIMITE_POR_MINUTO=60',
    `SMTP_URL=${cfg.smtpUrl}`,
    `CORREO_REMITENTE=no-responder@${p.dominio}`,
    `SES_CONFIGURATION_SET=${cfg.sesConfigurationSet}`,
    // R10: solo slugs de EJECUTOR_DEMOS del host B (migrate marca identidad_silo.es_demo).
    ...(demo ? ['ES_DEMO=true'] : []),
    '',
  ].join('\n');
}

const proyecto = (slug: string) => `erp-${slug}`;

/** Argumentos comunes de compose para el silo (rutas dentro del contenedor del ejecutor). */
export function argsCompose(cfg: Config, slug: string): string[] {
  const dir = `${cfg.silosDir}/${slug}`;
  return ['compose', '-p', proyecto(slug), '--project-directory', dir, '-f', `${dir}/docker-compose.yml`, '--env-file', `${dir}/.env`];
}

const IMAGEN_PERMITIDA = (cfg: Config) => new RegExp(`^(postgres:18-alpine|${cfg.registro.replace(/[.]/g, '\\.')}/vinculos-(api|web)@sha256:[0-9a-f]{64})$`);

export async function preparar(d: DockerApr, disco: DiscoSilos, c: Compose, cfg: Config, slug: string, pedido: Pedido, demo = false) {
  validarSlug(slug);
  const log: string[] = [];

  // Un erp-<slug> con contenedores y sin .env del ejecutor es de otro (servidor.sh, a mano): no se toca.
  const envPrevio = await disco.leerEnv(slug);
  const contenedores = await d.listar(proyecto(slug));
  if (envPrevio !== null && !envPrevio.startsWith(MARCA)) throw new ErrorVerbo(409, `silos/${slug}/.env no lo creo el ejecutor: no se toca`);
  if (envPrevio === null && contenedores.length) throw new ErrorVerbo(409, `${proyecto(slug)} ya tiene contenedores que no creo el ejecutor`);
  const previas = envPrevio ? leerVariables(envPrevio) : {};
  if (envPrevio && contenedores.length && previas.VINCULOS_VERSION !== pedido.version) {
    throw new ErrorVerbo(409, `${proyecto(slug)} ya corre ${previas.VINCULOS_VERSION}: cambiar de version es el job actualizar`);
  }

  // P0 (imagen): la version esta publicada y el registro tiene los dos digests.
  const texto = await disco.leerImagenes(pedido.version);
  if (texto === null) throw new ErrorVerbo(404, `no hay imagenes/${pedido.version}.env: publicar la version en el host B (publicar.sh)`);
  const img = imagenesDe(texto, pedido.version, cfg.registro);
  for (const ref of [img.api, img.web]) {
    if (!(await d.existeEnRegistro(ref))) throw new ErrorVerbo(409, `el registro no tiene ${ref}`);
  }
  log.push(`imagenes ${pedido.version}: ${img.apiDigest.slice(0, 19)}, ${img.webDigest.slice(0, 19)}`);

  // P2: secretos (se conservan los del .env previo) y token interno.
  const secretos: Record<string, string> = {};
  for (const k of SECRETOS) {
    const previo = previas[k];
    secretos[k] = previo && /^[0-9a-f]{48,64}$/.test(previo) ? previo : azar(k === 'JWT_SECRET' ? 32 : 24);
  }
  const conservados = SECRETOS.filter((k) => secretos[k] === previas[k]).length;
  let token = await disco.leerToken(slug);
  if (!token || !/^[0-9a-f]{64}$/.test(token.trim())) {
    token = azar(32);
    await disco.escribirToken(slug, token);
    log.push('token interno generado');
  } else {
    token = token.trim();
    log.push('token interno conservado');
  }
  await disco.escribirEnv(slug, contenidoEnv(slug, pedido, img, cfg, secretos, sha256(token), demo));
  if (demo) log.push('silo de demostracion (EJECUTOR_DEMOS): ES_DEMO=true');
  log.push(conservados ? `.env actualizado (${conservados} secretos conservados)` : '.env creado (secretos nuevos)');

  // P3: compose del silo y verificacion.
  await disco.escribirCompose(slug, renderizar(await disco.plantilla(), cfg.erpInfra));
  log.push(await validarCompose(c, cfg, slug, img));
  return { log, imagenes: { version: pedido.version, apiDigest: img.apiDigest, webDigest: img.webDigest } };
}

/** `docker compose config` del silo: valido y solo postgres + vinculos-api/web por digest (las de `img`). */
export async function validarCompose(c: Compose, cfg: Config, slug: string, img: { api: string; web: string }): Promise<string> {
  const base = argsCompose(cfg, slug);
  const conf = await c.correr([...base, 'config', '--quiet'], 60_000);
  if (conf.codigo !== 0) throw new ErrorVerbo(500, `docker compose config: ${conf.salida.slice(-400)}`);
  const imagenes = await c.correr([...base, 'config', '--images'], 60_000);
  if (imagenes.codigo !== 0) throw new ErrorVerbo(500, `docker compose config --images: ${imagenes.salida.slice(-400)}`);
  const permitida = IMAGEN_PERMITIDA(cfg);
  const lista = imagenes.salida.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const ajenas = lista.filter((x) => !permitida.test(x));
  if (ajenas.length || !lista.includes(img.api) || !lista.includes(img.web)) {
    throw new ErrorVerbo(500, `el compose del silo trae imagenes no permitidas: ${ajenas.join(', ') || 'faltan las de la version'}`);
  }
  return `compose de ${proyecto(slug)} valido (${new Set(lista).size} imagenes, todas por digest salvo postgres)`;
}

export type Fase = 'bd' | 'todo';
export function validarFase(p: unknown): Fase {
  const o = (p ?? {}) as Record<string, unknown>;
  if (Object.keys(o).length !== 1 || (o.fase !== 'bd' && o.fase !== 'todo')) throw new ErrorVerbo(400, 'se espera { fase: "bd" | "todo" }');
  return o.fase;
}

const ultimas = (t: string, n = 6) => t.split(/\r?\n/).filter((x) => x.trim()).slice(-n);

export async function levantar(disco: DiscoSilos, c: Compose, cfg: Config, slug: string, fase: Fase, ahora = new Date()) {
  validarSlug(slug);
  if (enVentanaRespaldo(ahora)) throw new ErrorVerbo(409, 'ventana de respaldo (01:45 a 02:30 Chile): intenta despues');
  const env = await disco.leerEnv(slug);
  if (env === null || !env.startsWith(MARCA) || !(await disco.existeCompose(slug))) throw new ErrorVerbo(409, `${proyecto(slug)} no esta preparado: correr preparar primero`);

  const base = argsCompose(cfg, slug);
  const servicios = fase === 'bd' ? ['db', 'migrate'] : [];
  const up = await c.correr([...base, 'up', '-d', '--no-build', '--pull', 'missing', '--quiet-pull', ...servicios], 15 * 60_000);
  if (up.codigo !== 0) {
    // Sin la KEK o la publica de recuperacion el daemon no crea backend ni frontend (falla cerrado).
    if (/bind source path does not exist: \S*\/secrets\//.test(up.salida)) {
      throw new ErrorVerbo(409, `faltan las llaves de ${slug} (P5, ESPERANDO_LLAVES): el operador corre infra/scripts/llaves/aprovisionar.sh del ERP`);
    }
    throw new ErrorVerbo(500, `docker compose up (${fase}): ${ultimas(up.salida).join(' | ')}`);
  }
  const log = [`up ${fase === 'bd' ? 'db y migrate' : 'silo completo'}`];

  // migrate corre en cada up (idempotente): se espera su codigo de salida.
  const w = await c.correr([...base, 'wait', 'migrate'], 10 * 60_000);
  // Salida de compose wait: container "<id>" exited with status code N. Sin esa linea no hay exito.
  const m = /exited with status code (\d+)/.exec(w.salida);
  if (w.codigo !== 0 || !m || m[1] !== '0') {
    throw new ErrorVerbo(500, `migrate termino con ${m ? m[1] : `?(${w.codigo})`}: revisar los logs de ${proyecto(slug)}-migrate-1`);
  }
  log.push('migrate termino en 0');

  const ps = await c.correr([...base, 'ps', '-a', '--format', '{{.Service}} {{.State}}'], 60_000);
  if (ps.codigo === 0) log.push(`estado: ${ps.salida.trim().split(/\r?\n/).join(', ')}`);
  return log;
}
