/**
 * Maquina de estados de un centro (CONTEXTO.md seccion 2). Funciones puras, con tests.
 *
 *   SOLICITUD -> CONTACTADO -> REUNION -> DATOS_COMPLETOS -> APROBADO
 *     -> APROVISIONANDO -> ACTIVO | ACTIVO_SIN_DOMINIO;  ACTIVO <-> SUSPENDIDO
 *     -> EN_SALIDA -> EXPORTADO -> GRACIA -> ELIMINADO
 *   DESCARTADO desde cualquier estado previo a APROBADO.
 */
import type { EstadoCentro } from '@prisma/client';

export const ANTES_DE_APROBADO: readonly EstadoCentro[] = ['SOLICITUD', 'CONTACTADO', 'REUNION', 'DATOS_COMPLETOS'];

export const TRANSICIONES: Record<EstadoCentro, readonly EstadoCentro[]> = {
  SOLICITUD: ['CONTACTADO', 'DESCARTADO'],
  CONTACTADO: ['REUNION', 'DESCARTADO'],
  REUNION: ['DATOS_COMPLETOS', 'DESCARTADO'],
  DATOS_COMPLETOS: ['APROBADO', 'DESCARTADO'],
  APROBADO: ['APROVISIONANDO'],
  APROVISIONANDO: ['ACTIVO', 'ACTIVO_SIN_DOMINIO'],
  ACTIVO_SIN_DOMINIO: ['ACTIVO', 'SUSPENDIDO', 'EN_SALIDA'],
  ACTIVO: ['ACTIVO_SIN_DOMINIO', 'SUSPENDIDO', 'EN_SALIDA'],
  SUSPENDIDO: ['ACTIVO', 'EN_SALIDA'],
  EN_SALIDA: ['EXPORTADO'],
  EXPORTADO: ['GRACIA'],
  GRACIA: ['ELIMINADO'],
  ELIMINADO: [],
  DESCARTADO: [],
};

export const puedeTransitar = (desde: EstadoCentro, hacia: EstadoCentro) => TRANSICIONES[desde].includes(hacia);

/**
 * Lo que el operador mueve a mano desde la consola. DATOS_COMPLETOS lo marca
 * normalmente el centro por su enlace; el operador tambien, si completo el
 * mismo los datos del centro (el servicio lo verifica). APROBADO tiene su
 * propio endpoint (P0 + contrato); el resto, los jobs (fase 4).
 */
export const MANUALES: readonly EstadoCentro[] = ['CONTACTADO', 'REUNION', 'DATOS_COMPLETOS', 'DESCARTADO'];

/** null = permitida; si no, el motivo del rechazo (texto para la consola). */
export function validarTransicionManual(desde: EstadoCentro, hacia: EstadoCentro, motivo?: string | null): string | null {
  if (!MANUALES.includes(hacia)) return `${hacia} no se marca a mano desde la consola`;
  if (!puedeTransitar(desde, hacia)) return `No se puede pasar de ${desde} a ${hacia}`;
  if (hacia === 'DESCARTADO' && !motivo?.trim()) return 'Descartar exige un motivo';
  return null;
}

/** Siguiente paso del pipeline comercial, para el boton principal de la consola. */
export const SIGUIENTE: Partial<Record<EstadoCentro, { hacia: EstadoCentro; accion: string }>> = {
  SOLICITUD: { hacia: 'CONTACTADO', accion: 'Marcar como contactado' },
  CONTACTADO: { hacia: 'REUNION', accion: 'Agendar reunion' },
  REUNION: { hacia: 'DATOS_COMPLETOS', accion: 'Marcar datos completos' },
};
