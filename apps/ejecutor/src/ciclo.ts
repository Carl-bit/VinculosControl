/**
 * Verbos del ciclo de vida de un silo (decision del usuario 2026-11-14:
 * opciones B + C de la salida, docs/propuesta-escritura-docker.md).
 *
 *   detener(slug)            B: para los contenedores de erp-<slug> (frontend,
 *                            backend, db). No borra contenedores, volumenes,
 *                            redes, secretos ni respaldos: se revierte con reanudar.
 *   reanudar(slug)           B: arranca los contenedores existentes (db, espera
 *                            sana, backend, frontend). Rollback de una salida en gracia.
 *   eliminar(slug, acta)     C: verbo que destruye un silo real. Borra contenedores,
 *                            volumenes y redes del proyecto erp-<slug> y la carpeta
 *                            respaldos/<slug>/ del host. Exige:
 *                              - consentimiento local en el host B: el archivo
 *                                bajas/<slug> (lo crea el operador a mano, el
 *                                ejecutor lo monta en solo lectura) con el hash del
 *                                acta de recepcion de esa salida;
 *                              - el mismo hash en la peticion (lo manda el plano de
 *                                control desde el acta registrada);
 *                              - el silo detenido y fuera de la ventana de respaldo.
 *                            No toca infra/secrets/<slug>/ (llaves: shred manual del
 *                            operador), el bucket externo, el DNS ni el crontab.
 *   eliminarDemo(slug)       Baja de un demo vencido (2026-11-19): solo slugs de
 *                            EJECUTOR_DEMOS con ES_DEMO=true en su .env; detiene
 *                            y borra lo mismo que eliminar, sin acta ni bajas/<slug>.
 * Todo nombre que se borra se valida contra el proyecto erp-<slug> (label de
 * compose y prefijo del nombre): nunca otro silo ni el plano del host.
 */
import * as fs from 'node:fs/promises';
import { join } from 'node:path';

import { type Contenedor, enVentanaRespaldo, ErrorVerbo, validarSlug } from './verbos';

export const HASH = /^[0-9a-f]{64}$/;

/** Orden de parada: primero lo que atiende trafico. migrate es de una pasada (ya esta detenido). */
const ORDEN_DETENER = ['frontend', 'backend', 'db'];
const ORDEN_ARRANCAR = ['db', 'backend', 'frontend'];

export interface Volumen {
  Name: string;
  Labels: Record<string, string> | null;
}
export interface RedProyecto {
  Id: string;
  Name: string;
  Labels: Record<string, string>;
}

/** API de Docker que usan estos verbos (inyectable para los tests). */
export interface DockerCiclo {
  listar(proyecto: string): Promise<Contenedor[]>;
  salud(id: string): Promise<string | null>;
  detener(id: string, timeoutS: number): Promise<void>;
  arrancar(id: string): Promise<void>;
  borrarContenedor(id: string): Promise<void>;
  volumenes(proyecto: string): Promise<Volumen[]>;
  borrarVolumen(nombre: string): Promise<void>;
  redes(proyecto: string): Promise<RedProyecto[]>;
  borrarRed(id: string): Promise<void>;
}

/** Disco del host que toca eliminar: consentimiento (solo lectura) y respaldos. */
export interface Disco {
  leerConsentimiento(slug: string): Promise<string | null>;
  /** Archivos de respaldos/<slug>/ (nombre y bytes); null si la carpeta no existe. Rechaza enlaces simbolicos. */
  respaldos(slug: string): Promise<{ archivo: string; bytes: number }[] | null>;
  borrarRespaldos(slug: string): Promise<void>;
  /**
   * Archivos del ejecutor para el silo: silos/<slug>/ (.env con sus secretos,
   * compose, anterior.env, demo-cuentas.txt) y tokens/<slug>.token. null si no
   * hay nada. Opcional: sin EJECUTOR_SILOS_DIR no se tocan. Nunca las llaves
   * (infra/secrets/<slug>/ del ERP): esas las borra el operador.
   */
  archivosSilo?(slug: string): Promise<string[] | null>;
  borrarArchivosSilo?(slug: string): Promise<void>;
}

const servicio = (c: Contenedor) => c.Labels['com.docker.compose.service'] ?? '?';
const proyecto = (slug: string) => `erp-${slug}`;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function enOrden(cs: Contenedor[], orden: string[]): Contenedor[] {
  const pos = (c: Contenedor) => {
    const i = orden.indexOf(servicio(c));
    return i === -1 ? orden.length : i;
  };
  return [...cs].sort((a, b) => pos(a) - pos(b));
}

/** B: detener. Idempotente: lo ya detenido se informa y no se toca. */
export async function detener(d: DockerCiclo, slug: string, ahora = new Date()) {
  validarSlug(slug);
  if (enVentanaRespaldo(ahora)) throw new ErrorVerbo(409, 'ventana de respaldo (01:45 a 02:30 Chile): intenta despues');
  const cs = await d.listar(proyecto(slug));
  if (!cs.length) throw new ErrorVerbo(404, `erp-${slug} no tiene contenedores`);
  const log: string[] = [];
  for (const c of enOrden(cs, ORDEN_DETENER)) {
    if (c.State !== 'running' && c.State !== 'restarting') {
      log.push(`${servicio(c)} ya estaba detenido (${c.State})`);
      continue;
    }
    await d.detener(c.Id, 30);
    log.push(`${servicio(c)} detenido (${c.Id.slice(0, 12)})`);
  }
  return log;
}

/**
 * B: reanudar. Arranca db y espera que este sana (hasta `esperaDbMs`), despues
 * backend y frontend. migrate no se arranca: es de una pasada y la base ya
 * esta migrada. Idempotente.
 */
export async function reanudar(d: DockerCiclo, slug: string, ahora = new Date(), esperaDbMs = 90_000, pasoMs = 3_000) {
  validarSlug(slug);
  if (enVentanaRespaldo(ahora)) throw new ErrorVerbo(409, 'ventana de respaldo (01:45 a 02:30 Chile): intenta despues');
  const cs = (await d.listar(proyecto(slug))).filter((c) => ORDEN_ARRANCAR.includes(servicio(c)));
  if (!cs.some((c) => servicio(c) === 'db')) throw new ErrorVerbo(404, `erp-${slug} no tiene db: no hay silo que reanudar`);
  const log: string[] = [];
  for (const c of enOrden(cs, ORDEN_ARRANCAR)) {
    if (c.State === 'running') log.push(`${servicio(c)} ya estaba en marcha`);
    else {
      await d.arrancar(c.Id);
      log.push(`${servicio(c)} arrancado (${c.Id.slice(0, 12)})`);
    }
    if (servicio(c) === 'db') {
      let salud = await d.salud(c.Id);
      for (let t = 0; salud !== null && salud !== 'healthy' && t < esperaDbMs; t += pasoMs) {
        await esperar(pasoMs);
        salud = await d.salud(c.Id);
      }
      if (salud !== null && salud !== 'healthy') throw new ErrorVerbo(504, `db de erp-${slug} no quedo sana (${salud}): backend y frontend no se arrancaron`);
      log.push(`db ${salud ?? 'sin healthcheck'}`);
    }
  }
  return log;
}

export interface Inventario {
  contenedores: string[];
  volumenes: string[];
  redes: string[];
  respaldos: { archivos: number; bytes: number };
}

/** Nombre de un recurso del proyecto: prefijo erp-<slug>_ o erp-<slug>- (compose) y label del proyecto. */
function delProyecto(slug: string, nombre: string, labels: Record<string, string> | null): boolean {
  const p = proyecto(slug);
  return (labels?.['com.docker.compose.project'] ?? '') === p && (nombre.startsWith(`${p}_`) || nombre.startsWith(`${p}-`) || nombre.startsWith(`/${p}-`));
}

/**
 * C: eliminar. Verifica todo antes de borrar lo primero (no deja un borrado a
 * medias por una precondicion). Idempotente: lo que ya no existe no falla.
 * Devuelve el inventario de lo borrado como evidencia para el acta.
 *
 * `soltarBorde` (Traefik y el agente fuera de erp-<slug>_borde, para poder
 * borrar la red) corre solo despues de pasar todas las precondiciones: un
 * pedido rechazado nunca debe dejar sin entrada a un silo en marcha (hallazgo
 * de la prueba contra Docker real, 2026-11-15).
 */
export async function eliminar(
  d: DockerCiclo,
  disco: Disco,
  slug: string,
  actaHash: string,
  ahora = new Date(),
  soltarBorde: () => Promise<string[]> = async () => [],
): Promise<{ log: string[]; inventario: Inventario }> {
  validarSlug(slug);
  if (!HASH.test(actaHash)) throw new ErrorVerbo(400, 'hash del acta invalido');
  if (enVentanaRespaldo(ahora)) throw new ErrorVerbo(409, 'ventana de respaldo (01:45 a 02:30 Chile): intenta despues');

  const consentimiento = (await disco.leerConsentimiento(slug))?.trim().toLowerCase() ?? null;
  if (consentimiento === null) throw new ErrorVerbo(403, `sin consentimiento local: crear bajas/${slug} en el host B con el hash del acta de recepcion`);
  if (consentimiento !== actaHash) throw new ErrorVerbo(403, `bajas/${slug} no tiene el hash del acta de recepcion de esta salida`);

  const cs = await d.listar(proyecto(slug));
  const enMarcha = cs.filter((c) => c.State === 'running' || c.State === 'restarting');
  if (enMarcha.length) throw new ErrorVerbo(409, `erp-${slug} sigue en marcha (${enMarcha.map(servicio).join(', ')}): detener primero`);
  const r = await borrarProyecto(d, disco, slug, cs, soltarBorde);
  r.log.push(`pendiente manual: shred de infra/secrets/${slug}/, bucket externo, DNS/tunel, crontab y bajas/${slug}`);
  return r;
}

/**
 * Borrado comun de eliminar y eliminarDemo, ya pasadas sus precondiciones.
 * Lee todo antes de borrar lo primero: si algo es inesperado no se empieza.
 */
async function borrarProyecto(d: DockerCiclo, disco: Disco, slug: string, cs: Contenedor[], soltarBorde: () => Promise<string[]>): Promise<{ log: string[]; inventario: Inventario }> {
  const vols = (await d.volumenes(proyecto(slug))).filter((v) => delProyecto(slug, v.Name, v.Labels));
  const redes = (await d.redes(proyecto(slug))).filter((r) => delProyecto(slug, r.Name, r.Labels));
  const resp = await disco.respaldos(slug);
  // Antes de borrar nada: si silos/<slug>/ tiene algo inesperado (enlace, subcarpeta), no se empieza.
  const delSilo = disco.archivosSilo ? await disco.archivosSilo(slug) : null;

  const log: string[] = [...(await soltarBorde())];
  const inventario: Inventario = { contenedores: [], volumenes: [], redes: [], respaldos: { archivos: 0, bytes: 0 } };
  for (const c of cs) {
    await d.borrarContenedor(c.Id);
    inventario.contenedores.push(`${servicio(c)} ${c.Id.slice(0, 12)}`);
  }
  log.push(`${cs.length} contenedor(es) borrado(s)`);
  for (const v of vols) {
    await d.borrarVolumen(v.Name);
    inventario.volumenes.push(v.Name);
  }
  log.push(`volumenes: ${inventario.volumenes.join(', ') || 'ninguno'}`);
  for (const r of redes) {
    await d.borrarRed(r.Id);
    inventario.redes.push(r.Name);
  }
  log.push(`redes: ${inventario.redes.join(', ') || 'ninguna'}`);
  if (resp) {
    await disco.borrarRespaldos(slug);
    inventario.respaldos = { archivos: resp.length, bytes: resp.reduce((s, x) => s + x.bytes, 0) };
    log.push(`respaldos/${slug}/: ${resp.length} archivo(s), ${inventario.respaldos.bytes} bytes`);
  } else log.push(`respaldos/${slug}/ no existe`);
  if (delSilo && disco.borrarArchivosSilo) {
    await disco.borrarArchivosSilo(slug);
    log.push(`archivos del ejecutor: ${delSilo.join(', ')}`);
  } else log.push(disco.archivosSilo ? `silos/${slug}/ no existe` : 'archivos del ejecutor: sin EJECUTOR_SILOS_DIR (no se tocan)');
  return { log, inventario };
}

/**
 * Baja de un demo vencido (decision del usuario 2026-11-19, opcion A). Solo
 * slugs de EJECUTOR_DEMOS cuyo .env lo escribio el ejecutor con ES_DEMO=true:
 * un demo no tiene datos reales, por eso no pide acta ni bajas/<slug>. Detiene
 * lo que siga en marcha, suelta el borde y borra como eliminar. Nunca toca
 * infra/secrets/<slug>/ (llaves: shred manual).
 *
 * `esDemo` lee silos/<slug>/.env: 'si' (marca del ejecutor y ES_DEMO=true),
 * 'no' (existe pero no es demo) o 'sin_env'. Sin .env solo se acepta si no
 * queda nada del proyecto (reintento tras un exito): un silo levantado a mano
 * con un slug de la lista nunca se borra por aqui.
 */
export async function eliminarDemo(
  d: DockerCiclo,
  disco: Disco,
  demos: string[],
  esDemo: (slug: string) => Promise<'si' | 'no' | 'sin_env'>,
  slug: string,
  ahora = new Date(),
  soltarBorde: () => Promise<string[]> = async () => [],
): Promise<{ log: string[]; inventario: Inventario }> {
  validarSlug(slug);
  if (!demos.includes(slug)) throw new ErrorVerbo(403, `${slug} no esta en EJECUTOR_DEMOS del host B: no es un silo de demostracion`);
  if (enVentanaRespaldo(ahora)) throw new ErrorVerbo(409, 'ventana de respaldo (01:45 a 02:30 Chile): intenta despues');
  const marca = await esDemo(slug);
  if (marca === 'no') throw new ErrorVerbo(409, `silos/${slug}/.env sin ES_DEMO=true o no lo escribio el ejecutor: no se borra como demo`);
  let cs = await d.listar(proyecto(slug));
  if (marca === 'sin_env') {
    const vols = (await d.volumenes(proyecto(slug))).filter((v) => delProyecto(slug, v.Name, v.Labels));
    if (cs.length || vols.length) throw new ErrorVerbo(409, `erp-${slug} existe pero sin silos/${slug}/.env del ejecutor: no se borra como demo`);
  }
  const log: string[] = [];
  const enMarcha = cs.filter((c) => c.State === 'running' || c.State === 'restarting');
  if (enMarcha.length) {
    log.push(...(await soltarBorde()));
    for (const c of enOrden(enMarcha, ORDEN_DETENER)) {
      await d.detener(c.Id, 30);
      log.push(`${servicio(c)} detenido (${c.Id.slice(0, 12)})`);
    }
    cs = await d.listar(proyecto(slug));
  }
  const r = await borrarProyecto(d, disco, slug, cs, enMarcha.length ? async () => [] : soltarBorde);
  r.log.unshift(...log);
  r.log.push(`pendiente manual: shred de infra/secrets/${slug}/ y hostname ${slug} del tunel`);
  return r;
}

const vacio = (i: Inventario) => !i.contenedores.length && !i.volumenes.length && !i.redes.length && !i.respaldos.archivos;

/**
 * Eliminacion previa de un slug en la auditoria local (JSON por linea): el
 * ultimo `eliminar` OK que si borro algo. Sirve cuando el agente perdio la
 * respuesta de un eliminar que si borro y reintenta: la segunda corrida no
 * encuentra nada, y sin esto el acta S7 recibiria un inventario vacio.
 */
export function eliminacionPrevia(auditoria: string, slug: string, verbo = 'eliminar'): { en: string; inventario: Inventario } | null {
  const lineas = auditoria.split('\n');
  for (let i = lineas.length - 1; i >= 0; i--) {
    if (!lineas[i].includes(`"${verbo}"`)) continue;
    try {
      const r = JSON.parse(lineas[i]) as { en?: string; verbo?: string; slug?: string; ok?: boolean; inventario?: Inventario };
      if (r.verbo === verbo && r.slug === slug && r.ok && r.inventario && !vacio(r.inventario)) return { en: r.en ?? '?', inventario: r.inventario };
    } catch {
      // linea cortada o ajena: se ignora
    }
  }
  return null;
}

/** Si esta corrida no borro nada, agrega al log lo que borro la corrida previa (evidencia para el acta). */
export function conPrevia(r: { log: string[]; inventario: Inventario }, auditoria: string, slug: string, verbo = 'eliminar') {
  if (!vacio(r.inventario)) return r;
  const p = eliminacionPrevia(auditoria, slug, verbo);
  if (!p) return r;
  const i = p.inventario;
  return {
    ...r,
    inventarioPrevio: p,
    log: [
      ...r.log,
      `eliminacion previa (${p.en}): ${i.contenedores.length} contenedor(es); volumenes: ${i.volumenes.join(', ') || 'ninguno'}; redes: ${i.redes.join(', ') || 'ninguna'}; respaldos/${slug}/: ${i.respaldos.archivos} archivo(s), ${i.respaldos.bytes} bytes`,
    ],
  };
}

/** Disco real: consentimiento en BAJAS_DIR (solo lectura) y respaldos en RESPALDOS_DIR. */
export function discoReal(bajasDir: string, respaldosDir: string, silos?: { silosDir: string; tokensDir: string }): Disco {
  const carpeta = (slug: string) => join(respaldosDir, validarSlug(slug));
  const delSilo = silos
    ? {
        async archivosSilo(slug: string) {
          const out: string[] = [];
          const dir = join(silos.silosDir, validarSlug(slug));
          let st;
          try {
            st = await fs.lstat(dir);
          } catch {
            st = null;
          }
          if (st) {
            if (st.isSymbolicLink() || !st.isDirectory()) throw new ErrorVerbo(409, `silos/${slug} no es una carpeta comun`);
            for (const n of await fs.readdir(dir)) {
              const s = await fs.lstat(join(dir, n));
              if (s.isSymbolicLink() || s.isDirectory()) throw new ErrorVerbo(409, `silos/${slug}/${n}: solo se esperan archivos`);
              out.push(`silos/${slug}/${n}`);
            }
          }
          const token = join(silos.tokensDir, `${slug}.token`);
          const t = await fs.lstat(token).catch(() => null);
          if (t?.isFile()) out.push(`tokens/${slug}.token`);
          return out.length ? out : null;
        },
        async borrarArchivosSilo(slug: string) {
          await fs.rm(join(silos.silosDir, validarSlug(slug)), { recursive: true, force: true });
          await fs.rm(join(silos.tokensDir, `${slug}.token`), { force: true });
        },
      }
    : {};
  return {
    ...delSilo,
    async leerConsentimiento(slug) {
      try {
        const st = await fs.lstat(join(bajasDir, validarSlug(slug)));
        if (!st.isFile() || st.size > 200) return null;
        return await fs.readFile(join(bajasDir, slug), 'utf8');
      } catch {
        return null;
      }
    },
    async respaldos(slug) {
      let st;
      try {
        st = await fs.lstat(carpeta(slug));
      } catch {
        return null;
      }
      if (st.isSymbolicLink() || !st.isDirectory()) throw new ErrorVerbo(409, `respaldos/${slug} no es una carpeta comun`);
      const out: { archivo: string; bytes: number }[] = [];
      for (const n of await fs.readdir(carpeta(slug))) {
        const s = await fs.lstat(join(carpeta(slug), n));
        if (s.isSymbolicLink() || s.isDirectory()) throw new ErrorVerbo(409, `respaldos/${slug}/${n}: solo se esperan archivos`);
        out.push({ archivo: n, bytes: s.size });
      }
      return out;
    },
    async borrarRespaldos(slug) {
      await fs.rm(carpeta(slug), { recursive: true, force: true });
    },
  };
}
