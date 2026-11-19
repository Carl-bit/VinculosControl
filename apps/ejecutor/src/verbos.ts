/**
 * Verbos cerrados del ejecutor (docs/propuesta-escritura-docker.md, opcion C).
 * El ejecutor es el UNICO proceso del host B con el socket de Docker. No recibe
 * comandos ni parametros libres: solo un slug validado y un verbo de esta lista.
 *
 *   estado(slug)          contenedores de erp-<slug> (servicio, estado, salud)
 *   reiniciar(slug)       reinicia backend y frontend; nunca db, nunca borra nada
 *   conectar_borde(slug)  une a erp-<slug>_borde los contenedores del plano del
 *                         host fijados en EJECUTOR_UNIR_BORDE (Traefik y agente)
 *   soltar_borde(slug)    los separa (antes de bajar el silo)
 *   reconectar_bordes()   conectar_borde de todas las redes de borde (tras
 *                         recrear Traefik o el agente)
 * Red de borde (R11): la crea el compose del silo con labels
 * cl.vinculos.red=borde y cl.vinculos.silo=<slug>; el ejecutor solo une a redes
 * con esas dos labels, nunca a interna ni silo.
 *
 * Sin verbos de borrado (decision 2026-11-12). Sin verbos que generen o lean
 * llaves: reiniciar_demo queda fuera hasta decidir como se tratan sus llaves.
 */

export const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/** El slug esta permitido como demo por EJECUTOR_DEMOS (exacto o por prefijo "demo-*"). */
export function esSlugDemo(demos: string[], slug: string): boolean {
  return SLUG.test(slug) && demos.some((d) => (d.endsWith('*') ? slug.startsWith(d.slice(0, -1)) && slug.length > d.length - 1 : d === slug));
}
/** Servicios que el ejecutor puede reiniciar. db queda fuera: reiniciarla corta conexiones y no es necesario. */
export const REINICIABLES = ['backend', 'frontend'] as const;

export interface Contenedor {
  Id: string;
  Labels: Record<string, string>;
  State: string;
  Status: string;
}

/** Lo minimo de la API de Docker que usa el ejecutor (inyectable para los tests). */
export interface Red {
  Id: string;
  Name: string;
  Labels: Record<string, string>;
  /** Claves: Id completo de cada contenedor unido. */
  Containers?: Record<string, unknown>;
}

export interface Docker {
  listar(proyecto: string): Promise<Contenedor[]>;
  reiniciar(id: string, timeoutS: number): Promise<void>;
  salud(id: string): Promise<string | null>;
  red(nombre: string): Promise<Red | null>;
  redesBorde(): Promise<Red[]>;
  contenedorId(nombre: string): Promise<string | null>;
  conectar(redId: string, contenedorId: string): Promise<void>;
  desconectar(redId: string, contenedorId: string): Promise<void>;
}

/** Nombre de contenedor de Docker (EJECUTOR_UNIR_BORDE). */
const NOMBRE_CONTENEDOR = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

/** Lista fija del .env del host B (nunca desde el plano de control). */
export function contenedoresBorde(valor: string | undefined): string[] {
  const lista = (valor ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const n of lista) if (!NOMBRE_CONTENEDOR.test(n)) throw new Error(`EJECUTOR_UNIR_BORDE: nombre invalido ${n}`);
  return lista;
}

export class ErrorVerbo extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export function validarSlug(slug: string): string {
  if (!SLUG.test(slug)) throw new ErrorVerbo(400, 'slug invalido');
  return slug;
}

/**
 * Ventana del respaldo diario (02:00 Chile, respaldar.sh del ERP): no se tocan
 * silos entre 01:45 y 02:30 (CLAUDE.md: no actualizar en la ventana de respaldo).
 */
export function enVentanaRespaldo(ahora: Date): boolean {
  const [h, m] = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(ahora)
    .split(':')
    .map(Number);
  const min = h * 60 + m;
  return min >= 105 && min < 150;
}

const servicio = (c: Contenedor) => c.Labels['com.docker.compose.service'] ?? '?';

export async function estado(d: Docker, slug: string) {
  const cs = await d.listar(`erp-${validarSlug(slug)}`);
  return Promise.all(cs.map(async (c) => ({ servicio: servicio(c), estado: c.State, detalle: c.Status, salud: await d.salud(c.Id) })));
}

export async function reiniciar(d: Docker, slug: string, ahora = new Date()) {
  validarSlug(slug);
  if (enVentanaRespaldo(ahora)) throw new ErrorVerbo(409, 'ventana de respaldo (01:45 a 02:30 Chile): intenta despues');
  const cs = (await d.listar(`erp-${slug}`)).filter((c) => (REINICIABLES as readonly string[]).includes(servicio(c)));
  if (!cs.length) throw new ErrorVerbo(404, `erp-${slug} no tiene backend ni frontend`);
  const log: string[] = [];
  // Primero backend (la API), despues frontend: el front depende de la API.
  for (const s of REINICIABLES) {
    for (const c of cs.filter((x) => servicio(x) === s)) {
      await d.reiniciar(c.Id, 20);
      log.push(`${s} reiniciado (${c.Id.slice(0, 12)})`);
    }
  }
  return log;
}

export const redBorde = (slug: string) => `erp-${slug}_borde`;

/** La red existe y es la de borde de ese silo (labels del compose del ERP, R11). */
async function redDelSilo(d: Docker, slug: string): Promise<Red | null> {
  const red = await d.red(redBorde(validarSlug(slug)));
  if (!red) return null;
  if (red.Labels['cl.vinculos.red'] !== 'borde' || red.Labels['cl.vinculos.silo'] !== slug) {
    throw new ErrorVerbo(409, `${red.Name} no tiene las labels de borde de ${slug}`);
  }
  return red;
}

export async function conectarBorde(d: Docker, slug: string, unir: string[]) {
  if (!unir.length) throw new ErrorVerbo(409, 'EJECUTOR_UNIR_BORDE vacio: no hay a quien unir');
  const red = await redDelSilo(d, slug);
  if (!red) throw new ErrorVerbo(404, `${redBorde(slug)} no existe: levantar el silo primero`);
  const unidos = new Set(Object.keys(red.Containers ?? {}));
  const log: string[] = [];
  for (const nombre of unir) {
    const id = await d.contenedorId(nombre);
    if (!id) throw new ErrorVerbo(404, `no existe el contenedor ${nombre}`);
    if (unidos.has(id)) {
      log.push(`${nombre} ya estaba en ${red.Name}`);
      continue;
    }
    await d.conectar(red.Id, id);
    log.push(`${nombre} unido a ${red.Name}`);
  }
  return log;
}

export async function soltarBorde(d: Docker, slug: string, unir: string[]) {
  const red = await redDelSilo(d, slug);
  if (!red) return [`${redBorde(slug)} no existe: nada que soltar`];
  const unidos = new Set(Object.keys(red.Containers ?? {}));
  const log: string[] = [];
  for (const nombre of unir) {
    const id = await d.contenedorId(nombre);
    if (!id || !unidos.has(id)) {
      log.push(`${nombre} no estaba en ${red.Name}`);
      continue;
    }
    await d.desconectar(red.Id, id);
    log.push(`${nombre} separado de ${red.Name}`);
  }
  return log;
}

export async function reconectarBordes(d: Docker, unir: string[]) {
  const log: string[] = [];
  for (const red of await d.redesBorde()) {
    const slug = red.Labels['cl.vinculos.silo'] ?? '';
    if (!SLUG.test(slug) || red.Name !== redBorde(slug)) {
      log.push(`${red.Name}: labels inconsistentes, omitida`);
      continue;
    }
    log.push(...(await conectarBorde(d, slug, unir)));
  }
  return log.length ? log : ['no hay redes de borde'];
}
