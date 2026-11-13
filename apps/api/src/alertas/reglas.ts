/**
 * Reglas de alerta del monitoreo (CONTEXTO.md, seccion 1, Monitoreo). Funcion
 * pura: recibe el ultimo estado conocido y devuelve las alertas que deben
 * estar abiertas. AlertasService abre las nuevas y cierra las que ya no estan.
 *
 * Severidad (seccion 8b): S1 = servicio caido o datos en riesgo, S2 =
 * degradado, S3 = aviso.
 */
export const UMBRAL = {
  /** Sondeos de /api/salud fallidos seguidos para declarar el silo caido. */
  saludFallos: 2,
  /** Fraccion del limite de memoria del contenedor (256M en el plan de 1 GB). */
  memoria: 0.9,
  discoPct: 80,
  /** p95 objetivo de 04_pruebas; con menos de n peticiones no se juzga. */
  p95Ms: 300,
  p95MinPeticiones: 20,
  respaldoHoras: 26,
  latidoSegundos: 120,
} as const;

export type Severidad = 'S1' | 'S2' | 'S3';

export interface AlertaActiva {
  clave: string;
  tipo: string;
  severidad: Severidad;
  slug?: string;
  mensaje: string;
}

export interface EstadoSilo {
  slug: string;
  /** Ultimos sondeos, el mas reciente primero. */
  salud: { ok: boolean; canarios: boolean | null; http: number | null; error: string | null }[];
  contenedores: {
    servicio: string;
    memBytes: number;
    memLimite: number;
    reinicios: number;
    /** null = primer reporte de ese contenedor (no hay con que comparar). */
    reiniciosPrevios: number | null;
    oom: boolean;
    estado: string;
  }[];
  latencias: { ruta: string; n: number; p95: number }[];
  respaldo: { fecha: Date } | null;
}

export interface Estado {
  ahora: Date;
  /** null = todavia no hay agente registrado. */
  agente: { nombre: string; ultimoLatido: Date | null } | null;
  host: { discoPct: number } | null;
  silos: EstadoSilo[];
}

const mib = (b: number) => Math.round(b / 1024 / 1024);

export function evaluar(e: Estado): AlertaActiva[] {
  const alertas: AlertaActiva[] = [];
  const abrir = (a: AlertaActiva) => alertas.push(a);

  if (e.agente) {
    const ultimo = e.agente.ultimoLatido;
    if (!ultimo || (e.ahora.getTime() - ultimo.getTime()) / 1000 > UMBRAL.latidoSegundos) {
      abrir({ clave: `agente:${e.agente.nombre}`, tipo: 'agente', severidad: 'S1', mensaje: `El agente ${e.agente.nombre} no reporta hace mas de 2 minutos` });
    }
  }
  if (e.host && e.host.discoPct > UMBRAL.discoPct) {
    abrir({ clave: 'host:disco', tipo: 'disco', severidad: 'S2', mensaje: `Disco del host B al ${Math.round(e.host.discoPct)} % (umbral ${UMBRAL.discoPct} %)` });
  }

  for (const s of e.silos) {
    const ultimos = s.salud.slice(0, UMBRAL.saludFallos);
    if (ultimos.length === UMBRAL.saludFallos && ultimos.every((m) => !m.ok)) {
      const m = ultimos[0]!;
      abrir({ clave: `salud:${s.slug}`, tipo: 'salud', severidad: 'S1', slug: s.slug, mensaje: `/api/salud falla: ${m.error ?? `HTTP ${m.http}`}` });
    }
    if (s.salud[0]?.canarios === false) {
      abrir({ clave: `canarios:${s.slug}`, tipo: 'canarios', severidad: 'S1', slug: s.slug, mensaje: 'Canarios en falso: la KEK del silo no descifra' });
    }
    for (const c of s.contenedores) {
      const id = `${s.slug}/${c.servicio}`;
      if (c.estado !== 'running') {
        abrir({ clave: `contenedor:${id}`, tipo: 'contenedor', severidad: 'S1', slug: s.slug, mensaje: `${c.servicio} en estado ${c.estado}` });
      }
      if (c.memLimite > 0 && c.memBytes / c.memLimite > UMBRAL.memoria) {
        abrir({ clave: `memoria:${id}`, tipo: 'memoria', severidad: 'S2', slug: s.slug, mensaje: `${c.servicio} usa ${mib(c.memBytes)} de ${mib(c.memLimite)} MiB` });
      }
      if (c.oom || (c.reiniciosPrevios !== null && c.reinicios > c.reiniciosPrevios)) {
        abrir({
          clave: `reinicio:${id}`,
          tipo: 'reinicio',
          severidad: 'S2',
          slug: s.slug,
          mensaje: c.oom ? `${c.servicio} murio por memoria (OOM)` : `${c.servicio} se reinicio (${c.reinicios} en total)`,
        });
      }
    }
    const lentas = s.latencias.filter((l) => l.n >= UMBRAL.p95MinPeticiones && l.p95 > UMBRAL.p95Ms);
    if (lentas.length > 0) {
      const peor = lentas.reduce((a, b) => (b.p95 > a.p95 ? b : a));
      abrir({
        clave: `latencia:${s.slug}`,
        tipo: 'latencia',
        severidad: 'S3',
        slug: s.slug,
        mensaje: `p95 sobre ${UMBRAL.p95Ms} ms en ${lentas.length} ruta(s); peor ${peor.ruta} con ${peor.p95} ms`,
      });
    }
    const horas = s.respaldo ? (e.ahora.getTime() - s.respaldo.fecha.getTime()) / 3_600_000 : Infinity;
    if (horas > UMBRAL.respaldoHoras) {
      abrir({
        clave: `respaldo:${s.slug}`,
        tipo: 'respaldo',
        severidad: 'S3',
        slug: s.slug,
        mensaje: s.respaldo ? `Ultimo respaldo hace ${Math.round(horas)} h` : 'Sin respaldos (instalar.sh no corre en este silo)',
      });
    }
  }
  return alertas;
}
