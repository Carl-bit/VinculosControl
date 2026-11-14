/**
 * Ejecutor de jobs del agente (CONTEXTO.md seccion 5). Modelo pull: reclama
 * por HTTPS, ejecuta y reporta cada paso. LISTA CERRADA: solo los pasos de
 * EJECUTORES; un codigo desconocido se reporta FALLIDO sin ejecutar nada.
 * Nunca corre comandos que vengan del plano de control, ni toca llaves.
 *
 * VERIFICAR (lectura, via docker-socket-proxy en modo GET): integridad del
 * manifiesto, red de Traefik, nombre libre y capacidad del host.
 * REINICIAR_SILO (E1-E3): se lo pide al ejecutor de silos (opcion C); el
 * agente nunca escribe en Docker.
 */
import { createHash } from 'node:crypto';

import { getJson, listar } from './docker';
import { host } from './host';
import { llamarSilo, tokenDe } from './solicitudes';

/**
 * Ejecutor de silos (opcion C): unico con el socket de Docker. El agente le
 * pide verbos cerrados por HTTP en una red interna, con su propio token. Sin
 * EJECUTOR_URL, el agente no reclama jobs que escriben.
 */
const EJECUTOR = (process.env.EJECUTOR_URL ?? '').replace(/\/$/, '');
const EJECUTOR_TOKEN = process.env.EJECUTOR_TOKEN ?? '';

/** RECONFIGURAR no usa el ejecutor: habla con /api/internal del silo (token por silo). */
export const TIPOS = EJECUTOR
  ? (['VERIFICAR', 'REINICIAR_SILO', 'RECONFIGURAR', 'DETENER_SILO', 'REANUDAR_SILO', 'ELIMINAR'] as const)
  : (['VERIFICAR', 'RECONFIGURAR'] as const);

interface EstadoContenedor {
  servicio: string;
  estado: string;
  detalle: string;
  salud: string | null;
}

type VerboEjecutor = 'estado' | 'reiniciar' | 'detener' | 'reanudar' | 'eliminar';

/** Unico cuerpo que acepta el ejecutor: { actaHash } en eliminar. */
async function ejecutor<T>(metodo: 'GET' | 'POST', slug: string, verbo: VerboEjecutor, envio?: { actaHash: string }): Promise<T> {
  if (!EJECUTOR) throw new Error('EJECUTOR_URL sin definir');
  const r = await fetch(`${EJECUTOR}/v1/silos/${encodeURIComponent(slug)}/${verbo}`, {
    method: metodo,
    headers: { authorization: `Bearer ${EJECUTOR_TOKEN}`, ...(envio ? { 'content-type': 'application/json' } : {}) },
    body: envio ? JSON.stringify(envio) : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  const cuerpo = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(`ejecutor ${verbo}: ${cuerpo.error ?? `HTTP ${r.status}`}`);
  return cuerpo;
}

interface RedDocker {
  Name: string;
  Driver: string;
  Containers?: Record<string, { Name?: string }>;
}

/** Contenedor de Traefik del host B (mismo nombre que en EJECUTOR_UNIR_BORDE). */
const TRAEFIK = process.env.TRAEFIK_CONTENEDOR || 'vinculos-servidor-traefik-1';

const lineaEstado = (c: EstadoContenedor) => `${c.servicio}: ${c.estado}${c.salud ? ` (${c.salud})` : ''} · ${c.detalle}`;

export interface JobReclamado {
  id: number;
  tipo: string;
  slug: string;
  revision: number;
  hashManifiesto: string;
  manifiesto: unknown;
  /** ELIMINAR: hash del acta de recepcion de la salida (el ejecutor lo compara con bajas/<slug>). */
  referencia?: string | null;
  pasos: { codigo: string; estado: string }[];
}

export interface Resultado {
  estado: 'OK' | 'FALLIDO' | 'OMITIDO';
  log: string[];
  error?: string;
}

/** JSON canonico (claves ordenadas): mismo algoritmo que @vinculos/manifest/hash (lo prueba agente.test.ts). */
export function jsonCanonico(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
    .join(',')}}`;
}

const GIB = 1024 ** 3;
/** Plan por silo: 1 GB / 1 vCPU (db 256M, backend 256M, frontend 256M). */
const RAM_SILO = 1 * GIB;

type Ejecutor = (j: JobReclamado) => Promise<Resultado>;

export const EJECUTORES: Record<string, Ejecutor> = {
  async V1(j) {
    const h = createHash('sha256').update(jsonCanonico(j.manifiesto)).digest('hex');
    return h === j.hashManifiesto
      ? { estado: 'OK', log: [`sha256 ${h.slice(0, 12)} = aprobado`] }
      : { estado: 'FALLIDO', log: [`sha256 ${h.slice(0, 12)} != ${j.hashManifiesto.slice(0, 12)}`], error: 'El manifiesto recibido no coincide con el hash aprobado' };
  },

  async V2() {
    let log: string[];
    try {
      const red = await getJson<RedDocker>('/networks/proxy');
      log = [`red ${red.Name} (${red.Driver}) con ${Object.keys(red.Containers ?? {}).length} contenedor(es)`];
    } catch (e) {
      return { estado: 'FALLIDO', log: ['docker network inspect proxy'], error: `No existe la red proxy de Traefik (${e instanceof Error ? e.message : String(e)})` };
    }
    // R11: Traefik debe estar en la red de borde de cada silo (si no, ese silo no recibe trafico).
    const filtro = encodeURIComponent(JSON.stringify({ label: ['cl.vinculos.red=borde'] }));
    const bordes = await getJson<RedDocker[]>(`/networks?filters=${filtro}`);
    const sinTraefik: string[] = [];
    for (const b of bordes) {
      const red = await getJson<RedDocker>(`/networks/${encodeURIComponent(b.Name)}`);
      const nombres = Object.values(red.Containers ?? {}).map((c) => c.Name ?? '');
      if (!nombres.includes(TRAEFIK)) sinTraefik.push(red.Name);
    }
    log.push(`${bordes.length} red(es) de borde; ${TRAEFIK} falta en ${sinTraefik.length}`);
    return sinTraefik.length
      ? { estado: 'FALLIDO', log, error: `${TRAEFIK} no esta en ${sinTraefik.join(', ')}: ejecutor reconectar_bordes` }
      : { estado: 'OK', log };
  },

  async V3(j) {
    const proyecto = `erp-${j.slug}`;
    const usados = (await listar()).filter((c) => c.Labels['com.docker.compose.project'] === proyecto);
    return usados.length
      ? { estado: 'FALLIDO', log: [`${proyecto}: ${usados.length} contenedor(es)`], error: `Ya existe el stack ${proyecto} en el host B` }
      : { estado: 'OK', log: [`stack ${proyecto} libre`] };
  },

  async V4() {
    // Requisito R1 del ERP: hoy cada silo construye su imagen; no hay vinculos-api/web en un registro.
    return { estado: 'OMITIDO', log: ['sin imagenes unicas en el registro (requisito R1 del ERP)'] };
  },

  // ---------- RECONFIGURAR (R4, por /api/internal/config) ----------
  async C1(j) {
    const m = (j.manifiesto ?? {}) as { modulos?: string[]; reglas?: Record<string, unknown> };
    if (!Array.isArray(m.modulos)) return { estado: 'FALLIDO', log: ['manifiesto sin modulos'], error: 'La revision no trae modulos' };
    const r = await llamarSilo<{ resultado: string }>(j.slug, await tokenDe(j.slug), 'POST', '/config', {
      revision: j.revision,
      hash: j.hashManifiesto,
      modulos: m.modulos,
      reglas: m.reglas ?? {},
    });
    return { estado: 'OK', log: [`${r.resultado}: rev ${j.revision} sha ${j.hashManifiesto.slice(0, 12)}`, `modulos ${m.modulos.join(', ') || 'solo nucleo'}`, `${Object.keys(m.reglas ?? {}).length} regla(s)`] };
  },

  async C2(j) {
    const c = await llamarSilo<{ revision: number | null; hash: string | null; modulos: string[] }>(j.slug, await tokenDe(j.slug), 'GET', '/config');
    const log = [`silo: rev ${c.revision ?? '-'} sha ${c.hash?.slice(0, 12) ?? '-'}`, `modulos activos ${c.modulos.join(', ')}`];
    return c.revision === j.revision && c.hash === j.hashManifiesto
      ? { estado: 'OK', log }
      : { estado: 'FALLIDO', log, error: 'El silo no confirma la revision aplicada' };
  },

  // ---------- REINICIAR_SILO (por el ejecutor) ----------
  async E1(j) {
    const { contenedores } = await ejecutor<{ contenedores: EstadoContenedor[] }>('GET', j.slug, 'estado');
    const reiniciables = contenedores.filter((c) => c.servicio === 'backend' || c.servicio === 'frontend');
    return reiniciables.length
      ? { estado: 'OK', log: contenedores.map(lineaEstado) }
      : { estado: 'FALLIDO', log: contenedores.map(lineaEstado), error: `erp-${j.slug} no tiene backend ni frontend` };
  },

  async E2(j) {
    const { log } = await ejecutor<{ log: string[] }>('POST', j.slug, 'reiniciar');
    return { estado: 'OK', log };
  },

  async E3(j) {
    // El reinicio deja los contenedores arrancando: se espera hasta 60 s a que esten en marcha (y sanos si tienen healthcheck).
    let ultimo: EstadoContenedor[] = [];
    for (let i = 0; i < 12; i++) {
      ultimo = (await ejecutor<{ contenedores: EstadoContenedor[] }>('GET', j.slug, 'estado')).contenedores.filter((c) => c.servicio === 'backend' || c.servicio === 'frontend');
      if (ultimo.length && ultimo.every((c) => c.estado === 'running' && (c.salud === null || c.salud === 'healthy'))) return { estado: 'OK', log: ultimo.map(lineaEstado) };
      await new Promise((r) => setTimeout(r, 5_000));
    }
    return { estado: 'FALLIDO', log: ultimo.map(lineaEstado), error: 'backend o frontend no quedaron en marcha en 60 s' };
  },

  // ---------- DETENER_SILO (salida S6; opcion B: no borra nada) ----------
  async D1(j) {
    const { contenedores } = await ejecutor<{ contenedores: EstadoContenedor[] }>('GET', j.slug, 'estado');
    return contenedores.length
      ? { estado: 'OK', log: contenedores.map(lineaEstado) }
      : { estado: 'FALLIDO', log: [], error: `erp-${j.slug} no tiene contenedores` };
  },

  async D2(j) {
    const { log } = await ejecutor<{ log: string[] }>('POST', j.slug, 'detener');
    return { estado: 'OK', log };
  },

  async D3(j) {
    const { contenedores } = await ejecutor<{ contenedores: EstadoContenedor[] }>('GET', j.slug, 'estado');
    const vivos = contenedores.filter((c) => c.estado === 'running' || c.estado === 'restarting');
    return vivos.length
      ? { estado: 'FALLIDO', log: contenedores.map(lineaEstado), error: `siguen en marcha: ${vivos.map((c) => c.servicio).join(', ')}` }
      : { estado: 'OK', log: contenedores.map(lineaEstado) };
  },

  // ---------- REANUDAR_SILO (rollback de una salida en gracia; opcion B) ----------
  async A1(j) {
    const { log } = await ejecutor<{ log: string[] }>('POST', j.slug, 'reanudar');
    return { estado: 'OK', log };
  },

  async A2(j) {
    // Igual que E3: hasta 90 s a que db, backend y frontend esten en marcha y sanos.
    let ultimo: EstadoContenedor[] = [];
    for (let i = 0; i < 18; i++) {
      ultimo = (await ejecutor<{ contenedores: EstadoContenedor[] }>('GET', j.slug, 'estado')).contenedores.filter((c) => ['db', 'backend', 'frontend'].includes(c.servicio));
      if (ultimo.length >= 3 && ultimo.every((c) => c.estado === 'running' && (c.salud === null || c.salud === 'healthy'))) return { estado: 'OK', log: ultimo.map(lineaEstado) };
      await new Promise((r) => setTimeout(r, 5_000));
    }
    return { estado: 'FALLIDO', log: ultimo.map(lineaEstado), error: 'db, backend o frontend no quedaron en marcha y sanos en 90 s' };
  },

  // ---------- ELIMINAR (salida S7; opcion C: consentimiento local bajas/<slug>) ----------
  async X1(j) {
    const { contenedores } = await ejecutor<{ contenedores: EstadoContenedor[] }>('GET', j.slug, 'estado');
    const vivos = contenedores.filter((c) => c.estado === 'running' || c.estado === 'restarting');
    return vivos.length
      ? { estado: 'FALLIDO', log: contenedores.map(lineaEstado), error: `erp-${j.slug} sigue en marcha (${vivos.map((c) => c.servicio).join(', ')}): detener primero` }
      : { estado: 'OK', log: contenedores.length ? contenedores.map(lineaEstado) : ['sin contenedores'] };
  },

  async X2(j) {
    if (!j.referencia || !/^[0-9a-f]{64}$/.test(j.referencia)) return { estado: 'FALLIDO', log: [], error: 'El job no trae el hash del acta de recepcion' };
    // El log del ejecutor lista lo borrado (volumenes, redes, respaldos): queda como evidencia en el paso y en el acta.
    const { log } = await ejecutor<{ log: string[] }>('POST', j.slug, 'eliminar', { actaHash: j.referencia });
    return { estado: 'OK', log };
  },

  async X3(j) {
    const { contenedores } = await ejecutor<{ contenedores: EstadoContenedor[] }>('GET', j.slug, 'estado');
    return contenedores.length
      ? { estado: 'FALLIDO', log: contenedores.map(lineaEstado), error: `quedan ${contenedores.length} contenedor(es) de erp-${j.slug}` }
      : { estado: 'OK', log: [`erp-${j.slug} sin contenedores`] };
  },

  async V5() {
    const h = await host();
    const libre = h.memTotal - h.memUsada;
    const log = [`disco ${h.discoPct} %`, `RAM libre ${(libre / GIB).toFixed(1)} GiB de ${(h.memTotal / GIB).toFixed(1)}`, `${h.cpus} vCPU, carga ${h.carga1}`];
    if (h.discoPct >= 80) return { estado: 'FALLIDO', log, error: 'Disco del host B sobre 80 %' };
    if (libre < RAM_SILO) return { estado: 'FALLIDO', log, error: 'Menos de 1 GiB de RAM libre para un silo nuevo' };
    return { estado: 'OK', log };
  },
};

type Enviar = (ruta: string, cuerpo: unknown) => Promise<Response>;

/** Ejecuta los pasos pendientes en orden. Se detiene si uno falla o si la API dice que pare (cancelado). */
export async function ejecutar(j: JobReclamado, enviar: Enviar, log: (m: string) => void): Promise<void> {
  for (const p of j.pasos.filter((x) => x.estado !== 'OK' && x.estado !== 'OMITIDO')) {
    const reportar = async (cuerpo: object) => {
      const r = await enviar(`jobs/${j.id}/pasos/${p.codigo}`, cuerpo);
      if (r.status === 409) return false;
      if (!r.ok) throw new Error(`paso ${p.codigo}: HTTP ${r.status}`);
      return ((await r.json()) as { seguir?: boolean }).seguir !== false;
    };
    if (!(await reportar({ estado: 'EN_CURSO' }))) return log(`job ${j.id} detenido por el plano de control`);
    const ejecutor = EJECUTORES[p.codigo];
    let res: Resultado;
    try {
      res = ejecutor ? await ejecutor(j) : { estado: 'FALLIDO', log: [], error: `Paso ${p.codigo} fuera de la lista cerrada del agente` };
    } catch (e) {
      res = { estado: 'FALLIDO', log: [], error: e instanceof Error ? e.message : String(e) };
    }
    log(`job ${j.id} ${p.codigo} ${res.estado}${res.error ? `: ${res.error}` : ''}`);
    const seguir = await reportar(res);
    if (res.estado === 'FALLIDO' || !seguir) return;
  }
}
