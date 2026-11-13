/**
 * Latencia por ruta desde los logs de pino del backend del ERP (misma idea que
 * infra/scripts/continuidad/p95.sh). Se calcula AQUI, en el host B: al plano
 * de control solo viajan agregados (ruta normalizada, n, p50, p95, max), nunca
 * una linea de log.
 */
export interface Latencia {
  ruta: string;
  n: number;
  p50: number;
  p95: number;
  max: number;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** "/api/citas/1b2c...?desde=x" -> "/api/citas/:id"; numeros sueltos -> ":n". */
export function normalizarRuta(url: string): string {
  const ruta = url.split('?')[0]!.replace(UUID, ':id').replace(/\/\d+(?=\/|$)/g, '/:n');
  return ruta.length > 150 ? ruta.slice(0, 150) : ruta;
}

/** Percentil por rango mas cercano (nearest-rank) sobre valores ya ordenados. */
const percentil = (orden: number[], p: number) => orden[Math.max(0, Math.ceil((p / 100) * orden.length) - 1)]!;

/** Lineas JSON de pino con "request completed" -> latencias por "METODO /ruta". Ignora lo que no calce. */
export function latenciasDesdeLogs(lineas: Iterable<string>): Latencia[] {
  const tiempos = new Map<string, number[]>();
  for (const linea of lineas) {
    if (!linea.includes('"responseTime"')) continue;
    let r: { req?: { method?: unknown; url?: unknown }; responseTime?: unknown };
    try {
      r = JSON.parse(linea) as typeof r;
    } catch {
      continue;
    }
    const { method, url } = r.req ?? {};
    if (typeof method !== 'string' || typeof url !== 'string' || typeof r.responseTime !== 'number' || !/^[A-Z]{3,7}$/.test(method)) continue;
    const ruta = `${method} ${normalizarRuta(url)}`;
    if (!/^[A-Z]{3,7} \/[\w/:.-]*$/.test(ruta)) continue;
    const lista = tiempos.get(ruta) ?? [];
    lista.push(Math.round(r.responseTime));
    tiempos.set(ruta, lista);
  }
  return [...tiempos].map(([ruta, t]) => {
    t.sort((a, b) => a - b);
    return { ruta, n: t.length, p50: percentil(t, 50), p95: percentil(t, 95), max: t[t.length - 1]! };
  });
}
