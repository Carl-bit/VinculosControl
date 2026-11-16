/**
 * Tarea 31 (R2/R3 del ERP): reglas puras de las solicitudes de modulos.
 * Mismas transiciones que responder_solicitud_modulo() en la BD del silo:
 *   PENDIENTE -> APROBADA | RECHAZADA
 *   APROBADA  -> APLICADA | RECHAZADA
 * APLICADA y RECHAZADA son finales.
 */

export const ESTADOS = ['PENDIENTE', 'APROBADA', 'RECHAZADA', 'APLICADA'] as const;
export type EstadoSolicitud = (typeof ESTADOS)[number];
export const DECISIONES = ['APROBADA', 'RECHAZADA', 'APLICADA'] as const;
export type Decision = (typeof DECISIONES)[number];

/** Enum modulo_centro del ERP. */
export const MODULOS = ['PAGINA_PUBLICA', 'FICHAS', 'AGENDA', 'EQUIPO', 'MATCH', 'WHATSAPP'] as const;
export const ROLES = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE', 'RESPONSABLE'] as const;

const SIGUIENTES: Record<EstadoSolicitud, readonly EstadoSolicitud[]> = {
  PENDIENTE: ['APROBADA', 'RECHAZADA'],
  APROBADA: ['APLICADA', 'RECHAZADA'],
  RECHAZADA: [],
  APLICADA: [],
};

export function transicionValida(desde: EstadoSolicitud, hacia: EstadoSolicitud): boolean {
  return SIGUIENTES[desde].includes(hacia);
}

/** Orden de avance (para no retroceder con un reporte atrasado del silo). */
const AVANCE: Record<EstadoSolicitud, number> = { PENDIENTE: 0, APROBADA: 1, RECHAZADA: 2, APLICADA: 2 };

export interface Registrada {
  estado: EstadoSolicitud;
  estadoSilo: EstadoSolicitud;
}

/**
 * Lo que queda en el plano de control cuando el silo reporta `delSilo`:
 * - nueva: la decision parte igual al silo;
 * - el silo avanzo mas alla de la decision (por ejemplo, el operador la aplico
 *   a mano y otro agente la confirmo): la decision lo sigue;
 * - si no, se mantiene la decision y solo se actualiza lo confirmado.
 */
export function fusionar(existente: Registrada | null, delSilo: EstadoSolicitud): Registrada {
  if (!existente) return { estado: delSilo, estadoSilo: delSilo };
  const estado = AVANCE[delSilo] > AVANCE[existente.estado] ? delSilo : existente.estado;
  return { estado, estadoSilo: delSilo };
}

/** Respuesta que falta entregar al silo (R3). */
export const porEntregar = (s: Registrada) => s.estado !== 'PENDIENTE' && s.estado !== s.estadoSilo;

/**
 * Proximo estado que se entrega al silo. El silo solo acepta transiciones de a
 * una (PENDIENTE -> APROBADA -> APLICADA): si la decision ya es APLICADA (el
 * job RECONFIGURAR la cerro) y el silo sigue en PENDIENTE, primero va APROBADA
 * y en el ciclo siguiente APLICADA.
 */
export function siguienteEntrega(s: Registrada): EstadoSolicitud {
  if (s.estado === 'APLICADA' && s.estadoSilo === 'PENDIENTE') return 'APROBADA';
  return s.estado;
}

/**
 * El silo rechazo de forma definitiva (HTTP 4xx) la entrega de APLICADA: por
 * ejemplo 422 "Los modulos activos del centro aun no reflejan la solicitud".
 * La decision vuelve a APROBADA (lo que el silo tiene) para que el operador
 * aplique el cambio y no se reintente cada minuto. Errores de red o 5xx son
 * transitorios: se reintenta. Devuelve el estado al que vuelve, o null.
 */
export function revertirRechazo(s: Registrada, error: string): EstadoSolicitud | null {
  if (s.estado !== 'APLICADA' || s.estadoSilo !== 'APROBADA') return null;
  return /^HTTP 4\d\d\b/.test(error) ? 'APROBADA' : null;
}
