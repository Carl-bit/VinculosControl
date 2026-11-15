/**
 * Feriados nacionales de Chile calculados por la ley, para cualquier año.
 * Port de `feriados_legales(año)` del ERP (migracion
 * 20261101001400_aud01_feriados_por_ley): mismas reglas y mismos algoritmos.
 *
 *   - fechas fijas (Ley 2.977 y modificaciones);
 *   - Viernes y Sabado Santo (Pascua, algoritmo gregoriano anonimo);
 *   - Pueblos Indigenas: dia del solsticio de invierno en Chile (Ley 21.357, Meeus cap. 27);
 *   - San Pedro y San Pablo (29-06) y Encuentro de Dos Mundos (12-10): martes a
 *     jueves al lunes de esa semana, viernes al lunes siguiente (Ley 19.668);
 *   - Iglesias Evangelicas (31-10): martes al viernes 27, miercoles al viernes 2-11 (Ley 20.299);
 *   - 2 de enero si el 1 cae domingo; 17 de septiembre si cae lunes o viernes;
 *     20 de septiembre si cae viernes (Leyes 20.983 y 20.215).
 *
 * Los que crea una ley puntual (o los regionales) no se calculan: van en
 * FERIADOS_EXTRA (fechas YYYY-MM-DD separadas por coma) del .env del host A.
 */

export interface Feriado {
  fecha: string;
  nombre: string;
}

const iso = (anio: number, mes: number, dia: number) => {
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.toISOString().slice(0, 10);
};
const masDias = (f: string, n: number) => new Date(Date.parse(`${f}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** 1 = lunes ... 7 = domingo (como isodow de Postgres). */
const isodow = (f: string) => ((new Date(`${f}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

export function pascua(anio: number): string {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return iso(anio, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
}

const TERMINOS: [number, number, number][] = [
  [485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186], [182, 27.85, 445267.112],
  [156, 73.14, 45036.886], [136, 171.52, 22518.443], [77, 222.54, 65928.934], [74, 296.72, 3034.906],
  [70, 243.58, 9037.513], [58, 119.81, 33718.147], [52, 297.17, 150.678], [50, 21.02, 2281.226],
  [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417], [18, 155.12, 67555.328],
  [17, 288.79, 4562.452], [16, 198.04, 62894.029], [14, 199.76, 31436.921], [12, 95.39, 14577.848],
  [12, 287.11, 31931.756], [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074],
];
const rad = (g: number) => (g * Math.PI) / 180;

/** Dia (hora de Chile) del solsticio de junio. Meeus, Astronomical Algorithms cap. 27 (años 2000 a 3000). */
export function solsticioInvierno(anio: number): string {
  const y = (anio - 2000) / 1000;
  const jde0 = 2451716.56767 + 365241.62603 * y + 0.00325 * y ** 2 + 0.00888 * y ** 3 - 0.0003 * y ** 4;
  const t = (jde0 - 2451545.0) / 36525;
  const w = rad(35999.373 * t - 2.47);
  const dl = 1 + 0.0334 * Math.cos(w) + 0.0007 * Math.cos(2 * w);
  const s = TERMINOS.reduce((acc, [a, b, c]) => acc + a * Math.cos(rad(b + c * t)), 0);
  // JDE (tiempo terrestre) a UTC: menos ~70 s.
  const jd = jde0 + (0.00001 * s) / dl - 70 / 86400;
  return fechaChile(new Date((jd - 2440587.5) * 86_400_000));
}

/** Ley 19.668: martes a jueves al lunes de esa semana; viernes al lunes siguiente. */
export function trasladarAlLunes(f: string): string {
  const desplazamiento: Record<number, number> = { 2: -1, 3: -2, 4: -3, 5: 3 };
  return masDias(f, desplazamiento[isodow(f)] ?? 0);
}

export function feriadosLegales(anio: number): Feriado[] {
  const f = (mes: number, dia: number) => iso(anio, mes, dia);
  const p = pascua(anio);
  const evangelicas = isodow(f(10, 31)) === 2 ? f(10, 27) : isodow(f(10, 31)) === 3 ? f(11, 2) : f(10, 31);
  const lista: (Feriado | null)[] = [
    { fecha: f(1, 1), nombre: 'Año Nuevo' },
    isodow(f(1, 1)) === 7 ? { fecha: f(1, 2), nombre: 'Feriado de Año Nuevo' } : null,
    { fecha: masDias(p, -2), nombre: 'Viernes Santo' },
    { fecha: masDias(p, -1), nombre: 'Sábado Santo' },
    { fecha: f(5, 1), nombre: 'Día Nacional del Trabajo' },
    { fecha: f(5, 21), nombre: 'Día de las Glorias Navales' },
    { fecha: solsticioInvierno(anio), nombre: 'Día Nacional de los Pueblos Indígenas' },
    { fecha: trasladarAlLunes(f(6, 29)), nombre: 'San Pedro y San Pablo' },
    { fecha: f(7, 16), nombre: 'Día de la Virgen del Carmen' },
    { fecha: f(8, 15), nombre: 'Asunción de la Virgen' },
    [1, 5].includes(isodow(f(9, 17))) ? { fecha: f(9, 17), nombre: 'Feriado adicional de Fiestas Patrias' } : null,
    { fecha: f(9, 18), nombre: 'Independencia Nacional' },
    { fecha: f(9, 19), nombre: 'Día de las Glorias del Ejército' },
    isodow(f(9, 20)) === 5 ? { fecha: f(9, 20), nombre: 'Feriado adicional de Fiestas Patrias' } : null,
    { fecha: trasladarAlLunes(f(10, 12)), nombre: 'Encuentro de Dos Mundos' },
    { fecha: evangelicas, nombre: 'Día de las Iglesias Evangélicas y Protestantes' },
    { fecha: f(11, 1), nombre: 'Día de Todos los Santos' },
    { fecha: f(12, 8), nombre: 'Inmaculada Concepción' },
    { fecha: f(12, 25), nombre: 'Navidad' },
  ];
  return lista.filter((x): x is Feriado => x !== null).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Fecha calendario (YYYY-MM-DD) de un instante en America/Santiago. */
export function fechaChile(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** FERIADOS_EXTRA: "2026-12-31,2027-01-03". Ignora lo que no sea una fecha. */
export function feriadosExtra(valor: string | undefined): Set<string> {
  return new Set(
    (valor ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter((x) => FECHA.test(x) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`))),
  );
}

const cache = new Map<number, Set<string>>();

/** true si la fecha (YYYY-MM-DD, hora de Chile) es feriado de ley o esta en `extra`. */
export function esFeriado(fecha: string, extra: Set<string> = new Set()): boolean {
  if (extra.has(fecha)) return true;
  const anio = Number(fecha.slice(0, 4));
  let del = cache.get(anio);
  if (!del) {
    del = new Set(feriadosLegales(anio).map((x) => x.fecha));
    cache.set(anio, del);
  }
  return del.has(fecha);
}
