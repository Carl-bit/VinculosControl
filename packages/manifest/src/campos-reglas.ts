import type { Reglas } from './reglas';

/**
 * Descriptor de cada regla para armar el formulario de la consola sin
 * escribir uno a mano. `def` = default de configuracion_centro en el ERP
 * (backend/prisma/schema.prisma). `grupo` ordena el formulario. Misma lista
 * cerrada que aplicar_config_interna() del ERP (R4).
 */
export type CampoRegla =
  | { k: keyof Reglas; l: string; grupo: string; tipo: 'entero' | 'decimal'; min: number; max: number; def: number }
  | { k: keyof Reglas; l: string; grupo: string; tipo: 'bool'; def: boolean }
  | { k: keyof Reglas; l: string; grupo: string; tipo: 'enum'; opciones: readonly string[]; def: string };

export const CAMPOS_REGLAS: readonly CampoRegla[] = [
  { k: 'rol_gestion_habilitado', l: 'Rol GESTION habilitado', grupo: 'Roles', tipo: 'bool', def: false },
  { k: 'max_cuentas_madre', l: 'Maximo de cuentas ADMIN', grupo: 'Roles', tipo: 'entero', min: 1, max: 10, def: 2 },
  { k: 'plazo_aviso_cancelacion_horas', l: 'Aviso de cancelacion (h)', grupo: 'Agenda', tipo: 'entero', min: 0, max: 720, def: 24 },
  { k: 'recordatorio_horas_antes', l: 'Recordatorio antes de la cita (h, 0 = sin)', grupo: 'Agenda', tipo: 'entero', min: 0, max: 168, def: 48 },
  { k: 'margen_traslado_min', l: 'Margen entre modalidades (min)', grupo: 'Agenda', tipo: 'entero', min: 0, max: 600, def: 30 },
  { k: 'horas_aprobacion_solicitud', l: 'Plazo para aprobar una hora pedida (h)', grupo: 'Agenda', tipo: 'entero', min: 1, max: 168, def: 24 },
  { k: 'minutos_retencion_solicitud', l: 'Retencion del horario al verificar correo (min)', grupo: 'Agenda', tipo: 'entero', min: 5, max: 120, def: 30 },
  { k: 'plazo_respuesta_derivacion_horas', l: 'Respuesta a derivacion (h)', grupo: 'Equipo', tipo: 'entero', min: 1, max: 8760, def: 24 },
  { k: 'plazo_consentimiento_horas', l: 'Consentimiento de practicante (h)', grupo: 'Equipo', tipo: 'entero', min: 1, max: 8760, def: 48 },
  { k: 'plazo_oposicion_horas', l: 'Plazo de oposicion (h)', grupo: 'Equipo', tipo: 'entero', min: 1, max: 8760, def: 48 },
  { k: 'match_filtro_directo', l: 'Match: "prefiero filtrar yo"', grupo: 'Match', tipo: 'bool', def: true },
  { k: 'dias_retencion_respuestas_match', l: 'Retencion de respuestas del match (dias)', grupo: 'Match', tipo: 'entero', min: 1, max: 365, def: 30 },
  { k: 'edad_minima_cuenta', l: 'Edad minima para cuenta propia', grupo: 'Pacientes', tipo: 'entero', min: 14, max: 18, def: 14 },
  { k: 'dias_gracia_cierre', l: 'Gracia al cerrar cuentas (dias)', grupo: 'Retencion', tipo: 'entero', min: 0, max: 3650, def: 30 },
  { k: 'retencion_mensajes_dias', l: 'Retencion de mensajes del equipo (dias)', grupo: 'Retencion', tipo: 'entero', min: 30, max: 3650, def: 365 },
];
