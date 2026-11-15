/**
 * Plazos de incidentes (CONTEXTO.md 8b; docs/cumplimiento/incidentes.md del ERP):
 *
 * |                | S1 critico      | S2 alto         | S3 medio             |
 * | Contencion     | max 1 h         | max 4 h         | max 2 dias habiles   |
 * | Aviso al centro| max 24 h        | max 48 h        | informe mensual      |
 * | Actualizaciones| cada 24 h       | cada 48 h       | -                    |
 * | Informe final  | 10 dias habiles | 10 dias habiles | 20 dias habiles      |
 *
 * Dias habiles = lunes a viernes en America/Santiago, sin los feriados de ley
 * (feriados.ts, mismas reglas que el ERP) ni los de FERIADOS_EXTRA.
 * Funciones puras, con tests en plazos.spec.ts y feriados.spec.ts.
 */
import { esFeriado, fechaChile, feriadosExtra } from './feriados';

export const SEVERIDADES = ['S1', 'S2', 'S3'] as const;
export type Severidad = (typeof SEVERIDADES)[number];

type Plazo = { horas: number } | { habiles: number };
interface Regla {
  contencion: Plazo;
  aviso: Plazo | null;
  actualizacionCadaH: number | null;
  informe: Plazo;
}

export const PLAZOS: Record<Severidad, Regla> = {
  S1: { contencion: { horas: 1 }, aviso: { horas: 24 }, actualizacionCadaH: 24, informe: { habiles: 10 } },
  S2: { contencion: { horas: 4 }, aviso: { horas: 48 }, actualizacionCadaH: 48, informe: { habiles: 10 } },
  S3: { contencion: { habiles: 2 }, aviso: null, actualizacionCadaH: null, informe: { habiles: 20 } },
};

const H = 3_600_000;
const DIA = 24 * H;

const diaSemana = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', weekday: 'short' }).format(d);

/** Feriados puntuales o regionales que la ley no fija con una regla (.env del host A). */
const EXTRA = feriadosExtra(process.env.FERIADOS_EXTRA);

/** Suma n dias habiles (lunes a viernes no feriados, hora de Chile) manteniendo la hora del dia. */
export function sumarHabiles(desde: Date, n: number, extra: Set<string> = EXTRA): Date {
  let d = new Date(desde.getTime());
  let quedan = n;
  while (quedan > 0) {
    d = new Date(d.getTime() + DIA);
    if (!['Sat', 'Sun'].includes(diaSemana(d)) && !esFeriado(fechaChile(d), extra)) quedan--;
  }
  return d;
}

export const vence = (desde: Date, p: Plazo) => ('horas' in p ? new Date(desde.getTime() + p.horas * H) : sumarHabiles(desde, p.habiles));

export type EstadoHito = 'cumplido' | 'cumplido_tarde' | 'pendiente' | 'por_vencer' | 'vencido' | 'no_aplica';

export interface Hito {
  clave: 'contencion' | 'aviso_centro' | 'actualizacion' | 'informe_final';
  l: string;
  venceEn: Date | null;
  cumplidoEn: Date | null;
  estado: EstadoHito;
}

export interface DatosIncidente {
  severidad: Severidad;
  detectadoEn: Date;
  contenidoEn: Date | null;
  avisoCentroEn: Date | null;
  ultimaActualizacionEn: Date | null;
  informeFinalEn: Date | null;
  cerradoEn: Date | null;
}

/** Estado de un hito: cumplido (a tiempo o tarde), o pendiente / por vencer (ultimo 25 % del plazo) / vencido. */
function estadoHito(desde: Date, venceEn: Date, cumplidoEn: Date | null, ahora: Date): EstadoHito {
  if (cumplidoEn) return cumplidoEn <= venceEn ? 'cumplido' : 'cumplido_tarde';
  if (ahora > venceEn) return 'vencido';
  const total = venceEn.getTime() - desde.getTime();
  return venceEn.getTime() - ahora.getTime() <= total * 0.25 ? 'por_vencer' : 'pendiente';
}

export function hitos(i: DatosIncidente, ahora: Date): Hito[] {
  const r = PLAZOS[i.severidad];
  const lista: Hito[] = [];
  const contencion = vence(i.detectadoEn, r.contencion);
  lista.push({ clave: 'contencion', l: 'Contencion', venceEn: contencion, cumplidoEn: i.contenidoEn, estado: estadoHito(i.detectadoEn, contencion, i.contenidoEn, ahora) });

  if (r.aviso) {
    const aviso = vence(i.detectadoEn, r.aviso);
    lista.push({ clave: 'aviso_centro', l: 'Aviso al centro', venceEn: aviso, cumplidoEn: i.avisoCentroEn, estado: estadoHito(i.detectadoEn, aviso, i.avisoCentroEn, ahora) });
  } else {
    lista.push({ clave: 'aviso_centro', l: 'Aviso al centro (informe mensual)', venceEn: null, cumplidoEn: i.avisoCentroEn, estado: i.avisoCentroEn ? 'cumplido' : 'no_aplica' });
  }

  // Actualizaciones periodicas al centro: desde el aviso (o la ultima actualizacion) hasta el informe final o el cierre.
  const base = i.ultimaActualizacionEn ?? i.avisoCentroEn;
  if (r.actualizacionCadaH && base && !i.informeFinalEn && !i.cerradoEn) {
    const proxima = new Date(base.getTime() + r.actualizacionCadaH * H);
    lista.push({ clave: 'actualizacion', l: `Actualizacion (cada ${r.actualizacionCadaH} h)`, venceEn: proxima, cumplidoEn: null, estado: estadoHito(base, proxima, null, ahora) });
  }

  const informe = vence(i.detectadoEn, r.informe);
  lista.push({ clave: 'informe_final', l: 'Informe final', venceEn: informe, cumplidoEn: i.informeFinalEn, estado: estadoHito(i.detectadoEn, informe, i.informeFinalEn, ahora) });
  return lista;
}

/** El peor estado manda el semaforo de la lista. */
export function semaforo(hs: Hito[]): 'vencido' | 'por_vencer' | 'al_dia' {
  if (hs.some((h) => h.estado === 'vencido')) return 'vencido';
  if (hs.some((h) => h.estado === 'por_vencer')) return 'por_vencer';
  return 'al_dia';
}

/** Soporte: la autorizacion del ADMIN dura de 1 a 72 h. */
export const venceSoporte = (autorizadaEn: Date, horas: number) => new Date(autorizadaEn.getTime() + horas * H);
export const estadoSoporte = (s: { estado: string; venceEn: Date }, ahora: Date) => (s.estado === 'ABIERTA' && s.venceEn <= ahora ? 'VENCIDA' : s.estado);
