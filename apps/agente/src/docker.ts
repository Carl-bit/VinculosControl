/**
 * Lectura de Docker a traves de docker-socket-proxy (solo GET de /containers
 * y /networks; POST y el resto de la API quedan bloqueados en el proxy). El agente nunca
 * monta el socket directo.
 */
const DOCKER = process.env.DOCKER_HOST_URL ?? 'http://socket-proxy:2375';

export interface ContenedorDocker {
  Id: string;
  Labels: Record<string, string>;
  State: string;
}

async function get(ruta: string): Promise<Response> {
  const r = await fetch(`${DOCKER}${ruta}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`docker GET ${ruta.split('?')[0]} -> ${r.status}`);
  return r;
}

export const getJson = async <T>(ruta: string): Promise<T> => (await get(ruta)).json() as Promise<T>;

/** Contenedores de compose (incluye detenidos). */
export function listar(): Promise<ContenedorDocker[]> {
  return getJson(`/containers/json?all=true&filters=${encodeURIComponent(JSON.stringify({ label: ['com.docker.compose.project'] }))}`);
}

/**
 * Slug del silo de un contenedor (R11): label cl.vinculos.silo, que debe
 * coincidir con el proyecto de compose erp-<slug>. Contenedores anteriores a
 * R11 (sin label) se reconocen por el proyecto. Inconsistente -> null.
 */
export function siloDe(labels: Record<string, string>): string | null {
  const proyecto = labels['com.docker.compose.project'] ?? '';
  const desdeProyecto = /^erp-[a-z0-9-]{1,40}$/.test(proyecto) ? proyecto.slice(4) : null;
  const label = labels['cl.vinculos.silo'];
  if (label === undefined) return desdeProyecto;
  return label === desdeProyecto ? label : null;
}

/** Dominio del silo desde la label del router de Traefik de su API: Host(`x`) && PathPrefix(`/api`). */
export function dominioDesdeLabels(labels: Record<string, string>): string | undefined {
  const regla = Object.entries(labels).find(([k]) => /^traefik\.http\.routers\.[^.]+-api\.rule$/.test(k))?.[1];
  return regla ? /Host\(`([a-z0-9.-]+)`\)/.exec(regla)?.[1] : undefined;
}

/**
 * Logs sin TTY vienen multiplexados: cabecera de 8 bytes por bloque (byte 0 =
 * stream, bytes 4-7 = largo). Devuelve las lineas de texto.
 */
export function lineasMultiplexadas(buf: Buffer): string[] {
  const partes: Buffer[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const largo = buf.readUInt32BE(i + 4);
    partes.push(buf.subarray(i + 8, i + 8 + largo));
    i += 8 + largo;
  }
  return Buffer.concat(partes).toString('utf8').split('\n');
}

/** Lineas de stdout de los ultimos `segundos`. */
export async function logs(id: string, segundos: number): Promise<string[]> {
  const desde = Math.floor(Date.now() / 1000) - segundos;
  const r = await get(`/containers/${id}/logs?stdout=true&stderr=false&since=${desde}`);
  return lineasMultiplexadas(Buffer.from(await r.arrayBuffer()));
}

interface Stats {
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
  memory_stats: { usage?: number; limit?: number; stats?: { inactive_file?: number; total_inactive_file?: number } };
}

/** CPU (% de una vCPU por 100, como docker stats) y memoria sin cache de archivos (como docker stats). */
export function calcularStats(s: Stats): { cpuPct: number; memBytes: number; memLimite: number } {
  const dCpu = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
  const dSis = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
  const cpuPct = dCpu > 0 && dSis > 0 ? (dCpu / dSis) * (s.cpu_stats.online_cpus ?? 1) * 100 : 0;
  const m = s.memory_stats;
  const cache = m.stats?.inactive_file ?? m.stats?.total_inactive_file ?? 0;
  return { cpuPct: Math.round(cpuPct * 10) / 10, memBytes: Math.max(0, (m.usage ?? 0) - cache), memLimite: m.limit ?? 0 };
}

export const stats = async (id: string) => calcularStats(await getJson<Stats>(`/containers/${id}/stats?stream=false`));

export const inspeccionar = (id: string) => getJson<{ RestartCount: number; State: { Status: string; OOMKilled: boolean } }>(`/containers/${id}/json`);
