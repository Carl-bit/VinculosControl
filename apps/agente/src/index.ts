/**
 * Agente del host B (CONTEXTO.md, seccion 1). Primera entrega: solo monitoreo.
 * Modelo pull: el agente llama al plano de control; nadie llama al agente.
 *   - latido cada 30 s
 *   - reporte cada 60 s: host, y por cada stack erp-<slug> sus contenedores
 *     (db, backend, frontend), p95 por ruta de los ultimos 5 min y ultimo respaldo
 *   - jobs cada 15 s: reclama (POST /agente/jobs/reclamar) y ejecuta solo los
 *     pasos de su lista cerrada (jobs.ts). Hoy, VERIFICAR (lectura).
 *   - solicitudes de modulos cada 60 s (tarea 31, solicitudes.ts): R2 del silo
 *     -> plano de control -> R3, por la red de borde de cada silo.
 *   - exportaciones del centro cada 60 s (R13, exportaciones.ts): solo metadatos.
 * Lista cerrada: no ejecuta comandos que vengan del plano de control.
 */
import { dominioDesdeLabels, inspeccionar, listar, logs, siloDe, stats, type ContenedorDocker } from './docker';
import { host, ultimoRespaldo } from './host';
import { ejecutar, type JobReclamado, TIPOS } from './jobs';
import { latenciasDesdeLogs } from './p95';
import { informarReleases } from './releases';
import { sincronizarExportaciones } from './exportaciones';
import { sincronizarSolicitudes } from './solicitudes';

const VERSION = '0.3.0';
const CONTROL = (process.env.CONTROL_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.AGENTE_TOKEN ?? '';
const SERVICIOS = new Set(['db', 'backend', 'frontend']);
const VENTANA_P95_S = 300;

function log(msg: string) {
  process.stdout.write(`${new Date().toISOString()} ${msg}\n`);
}

async function enviar(ruta: string, cuerpo: unknown): Promise<void> {
  const r = await fetch(`${CONTROL}/agente/${ruta}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`${ruta}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
}

async function contenedor(c: ContenedorDocker) {
  const info = await inspeccionar(c.Id);
  const enMarcha = info.State.Status === 'running';
  const uso = enMarcha ? await stats(c.Id) : { cpuPct: 0, memBytes: 0, memLimite: 0 };
  return { servicio: c.Labels['com.docker.compose.service']!, ...uso, reinicios: info.RestartCount, oom: info.State.OOMKilled, estado: info.State.Status };
}

async function reporte() {
  const porSilo = new Map<string, ContenedorDocker[]>();
  for (const c of await listar()) {
    const slug = siloDe(c.Labels);
    if (!slug || !SERVICIOS.has(c.Labels['com.docker.compose.service'] ?? '')) continue;
    porSilo.set(slug, [...(porSilo.get(slug) ?? []), c]);
  }
  const silos = await Promise.all(
    [...porSilo].map(async ([slug, cs]) => {
      const backend = cs.find((c) => c.Labels['com.docker.compose.service'] === 'backend');
      const [contenedores, latencias, respaldo] = await Promise.all([
        Promise.all(cs.map(contenedor)),
        backend?.State === 'running' ? logs(backend.Id, VENTANA_P95_S).then(latenciasDesdeLogs) : [],
        ultimoRespaldo(slug),
      ]);
      const dominio = backend && dominioDesdeLabels(backend.Labels);
      return { slug, ...(dominio ? { dominio } : {}), contenedores, latencias, ...(respaldo ? { respaldo } : {}) };
    }),
  );
  await enviar('reporte', { host: await host(), silos });
  return silos.length;
}

/** POST crudo (los jobs leen el status: 409 = el plano de control pide detenerse). */
function post(ruta: string, cuerpo: unknown): Promise<Response> {
  return fetch(`${CONTROL}/agente/${ruta}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(30_000),
  });
}

let ocupado = false;
/** Un job a la vez: reclama, ejecuta sus pasos y vuelve a reclamar hasta que no haya. */
async function jobs() {
  if (ocupado) return;
  ocupado = true;
  try {
    for (;;) {
      const r = await post('jobs/reclamar', { tipos: TIPOS });
      if (!r.ok) throw new Error(`reclamar: HTTP ${r.status}`);
      const j = (await r.json()) as JobReclamado | { job: null };
      if (!('id' in j)) return;
      log(`job ${j.id} ${j.tipo} ${j.slug} rev ${j.revision}`);
      await ejecutar(j, post, log);
    }
  } finally {
    ocupado = false;
  }
}

function cada(ms: number, tarea: () => Promise<unknown>, nombre: string) {
  const correr = () =>
    tarea().catch((e: unknown) => {
      log(`${nombre} fallo: ${e instanceof Error ? e.message : String(e)}`);
    });
  void correr();
  setInterval(correr, ms);
}

if (!CONTROL || TOKEN.length < 32) {
  log('Faltan CONTROL_URL o AGENTE_TOKEN (pnpm api agente:crear <nombre> en el host A)');
  process.exit(1);
}
log(`agente ${VERSION} -> ${CONTROL}`);
cada(30_000, () => enviar('latido', { version: VERSION }), 'latido');
cada(60_000, async () => log(`reporte: ${await reporte()} silo(s)`), 'reporte');
cada(15_000, jobs, 'jobs');
cada(60_000, async () => log(`solicitudes: ${await sincronizarSolicitudes(post, log)}`), 'solicitudes');
cada(60_000, async () => log(`exportaciones: ${await sincronizarExportaciones(post)}`), 'exportaciones');
// Releases del host B (infra/imagenes del ERP): cada 5 min; publicar es poco frecuente.
cada(300_000, async () => log(`releases: ${await informarReleases(post)}`), 'releases');
