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
import { host, ultimoRespaldo } from './host';
import { exporteEnCurso } from './exportaciones';
import { llamarSilo, tokenDe, urlSilo } from './solicitudes';

/**
 * Ejecutor de silos (opcion C): unico con el socket de Docker. El agente le
 * pide verbos cerrados por HTTP en una red interna, con su propio token. Sin
 * EJECUTOR_URL, el agente no reclama jobs que escriben.
 */
const EJECUTOR = (process.env.EJECUTOR_URL ?? '').replace(/\/$/, '');
const EJECUTOR_TOKEN = process.env.EJECUTOR_TOKEN ?? '';

/** RECONFIGURAR y SOLO_LECTURA no usan el ejecutor: hablan con /api/internal del silo (token por silo). */
export const TIPOS = EJECUTOR
  ? (['VERIFICAR', 'REINICIAR_SILO', 'RECONFIGURAR', 'SOLO_LECTURA', 'DETENER_SILO', 'REANUDAR_SILO', 'ELIMINAR', 'APROVISIONAR', 'ACTUALIZAR', 'REINICIAR_DEMO', 'ELIMINAR_DEMO'] as const)
  : (['VERIFICAR', 'RECONFIGURAR', 'SOLO_LECTURA'] as const);

interface EstadoContenedor {
  servicio: string;
  estado: string;
  detalle: string;
  salud: string | null;
}

type VerboEjecutor = 'estado' | 'reiniciar' | 'detener' | 'reanudar' | 'eliminar' | 'preparar' | 'levantar' | 'respaldar' | 'actualizar' | 'revertir' | 'cargar_demo' | 'resembrar_demo' | 'eliminar_demo';

/** Cuerpos que acepta el ejecutor (validados alli): eliminar, preparar, levantar y actualizar. */
type EnvioEjecutor = { actaHash: string } | { version: string; dominio: string; nombre: string; tema: string } | { fase: 'bd' | 'todo' } | { version: string } | { cuentasMadre: number; profesionales: number; pacientes: number; nombre: string };

/** Error del ejecutor con su status HTTP (409 de levantar sin llaves = esperar al operador). */
export class ErrorEjecutor extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

async function ejecutor<T>(metodo: 'GET' | 'POST', slug: string, verbo: VerboEjecutor, envio?: EnvioEjecutor): Promise<T> {
  if (!EJECUTOR) throw new Error('EJECUTOR_URL sin definir');
  const r = await fetch(`${EJECUTOR}/v1/silos/${encodeURIComponent(slug)}/${verbo}`, {
    method: metodo,
    headers: { authorization: `Bearer ${EJECUTOR_TOKEN}`, ...(envio ? { 'content-type': 'application/json' } : {}) },
    body: envio ? JSON.stringify(envio) : undefined,
    // levantar puede bajar imagenes y esperar migrate (el ejecutor corta a los 15 + 10 min); respaldar, un pg_dump completo.
    signal: AbortSignal.timeout(['levantar', 'respaldar', 'revertir', 'cargar_demo', 'resembrar_demo', 'eliminar_demo'].includes(verbo) ? 30 * 60_000 : 180_000),
  });
  const cuerpo = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new ErrorEjecutor(r.status, `ejecutor ${verbo}: ${cuerpo.error ?? `HTTP ${r.status}`}`);
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
  /** R6: notas de la version (solo ACTUALIZAR), para el ADMIN del silo. */
  notas?: string | null;
  pasos: { codigo: string; estado: string }[];
}

export interface Resultado {
  estado: 'OK' | 'FALLIDO' | 'OMITIDO';
  log: string[];
  error?: string;
  /** APROVISIONAR: el paso necesita al operador (P6 sin llaves, P8 sin dominio); el job queda esperando. */
  espera?: 'LLAVES' | 'DOMINIO';
  /** APROVISIONAR P2: version y digests que preparo el ejecutor (el silo guarda tag + digest). */
  datos?: { version: string; apiDigest: string; webDigest: string };
}

/** Lo que APROVISIONAR lee del manifiesto aprobado (ya validado en P0 por el plano de control). */
interface ManifiestoAprov {
  centro?: { nombre?: string; admin?: { nombre?: string; correo?: string } };
  dominio?: { valor?: string };
  version?: { fija?: string };
  estilo?: { tema?: string };
  modulos?: string[];
  reglas?: Record<string, unknown>;
  /** Silo de demostracion (R10): en P10 se generan datos ficticios en vez de invitar al ADMIN. */
  demo?: { cuentas_madre: number; profesionales: number; pacientes: number };
}

/** /api/salud del silo por su red de borde (mismo backend que /api/internal). */
const urlSalud = (slug: string) => urlSilo(slug).replace(/\/internal$/, '/salud');

interface Salud {
  estado?: string;
  bd?: boolean;
  canarios?: boolean;
}

async function salud(url: string, ms = 10_000): Promise<{ http: number; s: Salud } | { http: 0; error: string }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: 'manual' });
    return { http: r.status, s: (await r.json().catch(() => ({}))) as Salud };
  } catch (e) {
    const causa = (e as { cause?: { code?: string } }).cause?.code;
    return { http: 0, error: causa ?? (e instanceof Error ? e.message : String(e)) };
  }
}
const lineaSalud = (r: Awaited<ReturnType<typeof salud>>) =>
  'error' in r ? `sin respuesta (${r.error})` : `HTTP ${r.http} estado ${r.s.estado ?? '?'} bd ${r.s.bd ?? '?'} canarios ${r.s.canarios ?? '?'}`;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  // ---------- REINICIAR_DEMO (R10 B: resembrar, sin borrar nada) ----------
  async R1(j) {
    const { log } = await ejecutor<{ log: string[] }>('POST', j.slug, 'resembrar_demo');
    return { estado: 'OK', log };
  },

  // ---------- SOLO_LECTURA (R12, salida S2, por /api/internal/salida) ----------
  async L1(j) {
    const activar = /^ACTIVAR:(\d{4}-\d{2}-\d{2})$/.exec(j.referencia ?? '');
    if (!activar && j.referencia !== 'QUITAR') return { estado: 'FALLIDO', log: [], error: 'El job no trae ACTIVAR:<fecha> ni QUITAR' };
    const token = await tokenDe(j.slug);
    const cuerpo = activar ? { soloLectura: true, fechaCorte: activar[1] } : { soloLectura: false };
    let r: { resultado: string };
    try {
      r = await llamarSilo<{ resultado: string }>(j.slug, token, 'POST', '/salida', cuerpo);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/^HTTP 404\b/.test(m)) return { estado: 'FALLIDO', log: [m], error: 'El ERP del silo no tiene R12 (anterior a 2026-11-16): actualizar el silo y reintentar, o avisar a los usuarios a mano' };
      throw e;
    }
    const e = await llamarSilo<{ soloLectura: boolean; fechaCorte: string | null }>(j.slug, token, 'GET', '/salida');
    const log = [`${r.resultado}: ${activar ? `solo lectura, corte ${activar[1]}` : 'escritura normal'}`, `silo: soloLectura=${e.soloLectura} corte=${e.fechaCorte ?? '-'}`];
    return e.soloLectura === !!activar && (e.fechaCorte ?? null) === (activar?.[1] ?? null)
      ? { estado: 'OK', log }
      : { estado: 'FALLIDO', log, error: 'El silo no confirma el estado pedido' };
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

  // ---------- ELIMINAR_DEMO (demo vencido; el ejecutor exige EJECUTOR_DEMOS y ES_DEMO=true) ----------
  async Y1(j) {
    const { log } = await ejecutor<{ log: string[] }>('POST', j.slug, 'eliminar_demo');
    return { estado: 'OK', log };
  },

  async Y2(j) {
    return EJECUTORES.X3(j);
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

  // ---------- APROVISIONAR (CONTEXTO.md seccion 5; por el ejecutor y /api/internal) ----------
  async P2(j) {
    // Integridad y capacidad primero (como VERIFICAR V1 y V5): nada se crea si fallan.
    const integridad = await EJECUTORES.V1(j);
    if (integridad.estado !== 'OK') return integridad;
    const capacidad = await EJECUTORES.V5(j);
    if (capacidad.estado !== 'OK') return capacidad;
    const m = (j.manifiesto ?? {}) as ManifiestoAprov;
    // La version la resolvio P0 (fija o la del canal) y viaja en el job.
    const pedido = { version: j.referencia ?? m.version?.fija ?? '', dominio: m.dominio?.valor ?? '', nombre: m.centro?.nombre ?? '', tema: m.estilo?.tema ?? 'moderno' };
    const r = await ejecutor<{ log: string[]; imagenes: { version: string; apiDigest: string; webDigest: string } }>('POST', j.slug, 'preparar', pedido);
    return { estado: 'OK', log: [...integridad.log, ...capacidad.log, ...r.log], datos: r.imagenes };
  },

  async P4(j) {
    const { log } = await ejecutor<{ log: string[] }>('POST', j.slug, 'levantar', { fase: 'bd' });
    return { estado: 'OK', log };
  },

  async P6(j) {
    let log: string[];
    try {
      log = (await ejecutor<{ log: string[] }>('POST', j.slug, 'levantar', { fase: 'todo' })).log;
    } catch (e) {
      // Sin KEK el ejecutor responde 409 ESPERANDO_LLAVES: vuelve a P5 (manual), no es un fallo del job.
      if (e instanceof ErrorEjecutor && e.status === 409 && e.message.includes('ESPERANDO_LLAVES')) {
        return { estado: 'FALLIDO', log: [], error: e.message, espera: 'LLAVES' };
      }
      throw e;
    }
    // La API arranca solo si la huella de la KEK y los canarios coinciden: hasta 3 min a /api/salud 200.
    let ultimo = await salud(urlSalud(j.slug));
    for (let i = 0; i < 36 && !(ultimo.http === 200 && !('error' in ultimo) && ultimo.s.estado === 'ok'); i++) {
      await esperar(5_000);
      ultimo = await salud(urlSalud(j.slug));
    }
    log.push(`/api/salud por el borde: ${lineaSalud(ultimo)}`);
    return ultimo.http === 200 && !('error' in ultimo) && ultimo.s.estado === 'ok'
      ? { estado: 'OK', log }
      : { estado: 'FALLIDO', log, error: 'La API del silo no respondio /api/salud 200 en 3 min (revisar llaves y canarios: logs de erp-<slug>-backend-1)' };
  },

  async P7(j) {
    // Carga inicial = la revision aprobada por /api/internal/config (R4); igual que RECONFIGURAR C1 + C2.
    const aplicar = await EJECUTORES.C1(j);
    if (aplicar.estado !== 'OK') return aplicar;
    const confirmar = await EJECUTORES.C2(j);
    return { ...confirmar, log: [...aplicar.log, ...confirmar.log] };
  },

  async P8(j) {
    const dominio = ((j.manifiesto ?? {}) as ManifiestoAprov).dominio?.valor ?? '';
    if (!/^[a-z0-9.-]{4,253}$/.test(dominio)) return { estado: 'FALLIDO', log: [], error: 'El manifiesto no trae un dominio valido' };
    // Por fuera, como un usuario: tunel de Cloudflare -> Traefik -> silo (con certificado valido).
    const r = await salud(`https://${dominio}/api/salud`, 15_000);
    const log = [`https://${dominio}/api/salud: ${lineaSalud(r)}`];
    if (r.http === 200 && !('error' in r) && r.s.estado === 'ok') return { estado: 'OK', log };
    return { estado: 'FALLIDO', log, error: `El dominio ${dominio} aun no llega al silo: configurar la ruta en el tunel y confirmar en la consola`, espera: 'DOMINIO' };
  },

  async P9(j) {
    const r = await ultimoRespaldo(j.slug);
    if (!r) return { estado: 'FALLIDO', log: [`respaldos/${j.slug}/ sin respaldos`], error: `Sin respaldo: correr infra/scripts/continuidad/instalar.sh del ERP para ${j.slug} (respaldo.key, cron 02:00) y un primer respaldar.sh; luego reintentar desde P9` };
    const log = [`ultimo respaldo ${r.archivo} (${r.bytes} bytes, ${r.fecha})`];
    // respaldar.sh deja 32 bytes con la db detenida (R14 del ERP): un respaldo real pesa mas.
    if (r.bytes < 1024) return { estado: 'FALLIDO', log, error: 'El respaldo es demasiado chico para ser real (R14)' };
    if (!r.sha256) return { estado: 'FALLIDO', log, error: `Falta ${r.archivo}.sha256` };
    log.push(`sha256 ${r.sha256.slice(0, 12)}`);
    return { estado: 'OK', log };
  },

  async P10(j) {
    const m = (j.manifiesto ?? {}) as ManifiestoAprov;
    if (m.demo) {
      // Demo (R10): el ejecutor genera las cuentas y los datos; correos y contrasena quedan en el host B.
      const r = await ejecutor<{ log: string[] }>('POST', j.slug, 'cargar_demo', {
        cuentasMadre: m.demo.cuentas_madre,
        profesionales: m.demo.profesionales,
        pacientes: m.demo.pacientes,
        nombre: m.centro?.nombre ?? j.slug,
      });
      return { estado: 'OK', log: r.log };
    }
    const admin = m.centro?.admin;
    if (!admin?.correo || !admin.nombre) return { estado: 'FALLIDO', log: [], error: 'El manifiesto no trae el ADMIN inicial' };
    let r: { invitada: boolean; vence?: string };
    try {
      // Mismo correo pendiente: el ERP renueva la invitacion (reintento idempotente).
      r = await llamarSilo<{ invitada: boolean; vence?: string }>(j.slug, await tokenDe(j.slug), 'POST', '/admin-inicial', { email: admin.correo, nombre: admin.nombre });
    } catch (e) {
      // Reintento despues de que el ADMIN activo su cuenta: el objetivo del paso ya se cumplio.
      if (e instanceof Error && e.message.includes('cuenta madre activa')) return { estado: 'OK', log: ['el centro ya tiene su cuenta madre activa'] };
      throw e;
    }
    // Solo el resultado: el enlace de la invitacion nunca sale del silo (va por correo al ADMIN).
    return { estado: 'OK', log: [`invitacion del ADMIN inicial enviada (vence ${r.vence ?? '?'})`] };
  },

  // ---------- ACTUALIZAR (seccion 7; un silo a la vez, por el ejecutor) ----------
  async U1(j) {
    // R13 en vivo: el plano de control lo reviso al crear el job, pero un exporte pudo empezar despues.
    const exp = await exporteEnCurso(j.slug, await tokenDe(j.slug));
    if (exp.enCurso) return { estado: 'FALLIDO', log: [], error: `El centro tiene una exportacion ${exp.enCurso.estado} (creada ${exp.enCurso.creadaEn}): reintentar al terminar` };
    const previo = exp.sinR13 ? 'el silo no informa R13 (ERP anterior): vale la confirmacion del operador' : 'sin exportacion en curso (R13, en vivo)';
    const { log } = await ejecutor<{ log: string[] }>('POST', j.slug, 'respaldar');
    return { estado: 'OK', log: [previo, ...log] };
  },

  async U2(j) {
    if (!j.referencia) return { estado: 'FALLIDO', log: [], error: 'El job no trae la version' };
    const { log } = await ejecutor<{ log: string[] }>('POST', j.slug, 'actualizar', { version: j.referencia });
    return { estado: 'OK', log };
  },

  async U3(j) {
    return conVueltaAtras(j, async () => (await ejecutor<{ log: string[] }>('POST', j.slug, 'levantar', { fase: 'bd' })).log);
  },

  async U4(j) {
    return conVueltaAtras(j, async () => (await ejecutor<{ log: string[] }>('POST', j.slug, 'levantar', { fase: 'todo' })).log);
  },

  async U5(j) {
    return conVueltaAtras(j, async () => {
      const ultimo = await esperarSalud(urlSalud(j.slug));
      const linea = `/api/salud por el borde: ${lineaSalud(ultimo)}`;
      if (!saludOk(ultimo)) throw Object.assign(new Error('La API no respondio /api/salud 200 en 3 min con la version nueva'), { log: [linea] });
      return [linea];
    });
  },

  /** R6: notas de la version para el ADMIN. El silo ya corre la version nueva: si no se entregan, queda en el log y el job sigue OK. */
  async U6(j) {
    if (!j.notas?.trim()) return { estado: 'OK', log: ['sin notas para esta version'] };
    try {
      const r = await llamarSilo<{ resultado: string }>(j.slug, await tokenDe(j.slug), 'POST', '/notas-version', { version: j.referencia, notas: j.notas });
      return { estado: 'OK', log: [`${r.resultado}: notas de ${j.referencia} (${j.notas.length} caracteres)`] };
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      return { estado: 'OK', log: [/^HTTP 404\b/.test(m) ? 'el ERP del silo no tiene R6: notas no entregadas' : `notas no entregadas: ${m.slice(0, 200)}`] };
    }
  },
};

const saludOk = (r: Awaited<ReturnType<typeof salud>>) => r.http === 200 && !('error' in r) && r.s.estado === 'ok';

/** Hasta 3 min a /api/salud 200 (la API arranca solo con la KEK y los canarios en orden). */
async function esperarSalud(url: string) {
  let ultimo = await salud(url);
  for (let i = 0; i < 36 && !saludOk(ultimo); i++) {
    await esperar(5_000);
    ultimo = await salud(url);
  }
  return ultimo;
}

/**
 * Pasos de ACTUALIZAR despues de cambiar la imagen: si fallan, el silo vuelve a
 * la imagen anterior (revertir) y se comprueba su salud antes de reportar el
 * fallo. Nunca queda a medio actualizar; el job queda FALLIDO y se reintenta.
 */
async function conVueltaAtras(j: JobReclamado, paso: () => Promise<string[]>): Promise<Resultado> {
  try {
    return { estado: 'OK', log: await paso() };
  } catch (e) {
    const log = [...((e as { log?: string[] }).log ?? [])];
    const motivo = e instanceof Error ? e.message : String(e);
    try {
      const r = await ejecutor<{ log: string[]; imagenes: { version: string } }>('POST', j.slug, 'revertir');
      log.push(...r.log);
      const despues = await esperarSalud(urlSalud(j.slug));
      log.push(`tras volver a ${r.imagenes.version}: /api/salud ${lineaSalud(despues)}`);
      return { estado: 'FALLIDO', log, error: `${motivo}. Vuelto a ${r.imagenes.version}${saludOk(despues) ? ' (silo sano)' : ' (REVISAR: el silo no responde)'}` };
    } catch (e2) {
      return { estado: 'FALLIDO', log, error: `${motivo}. La vuelta atras tambien fallo: ${e2 instanceof Error ? e2.message : String(e2)} (REVISAR el silo a mano)` };
    }
  }
}

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
    // Un paso largo (levantar baja imagenes y espera migrate) renueva la reserva cada minuto.
    const reserva = setInterval(() => void enviar(`jobs/${j.id}/reserva`, {}).catch(() => undefined), 60_000);
    try {
      res = ejecutor ? await ejecutor(j) : { estado: 'FALLIDO', log: [], error: `Paso ${p.codigo} fuera de la lista cerrada del agente` };
    } catch (e) {
      res = { estado: 'FALLIDO', log: [], error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearInterval(reserva);
    }
    log(`job ${j.id} ${p.codigo} ${res.estado}${res.error ? `: ${res.error}` : ''}`);
    const seguir = await reportar(res);
    if (res.estado === 'FALLIDO' || !seguir) return;
  }
}
