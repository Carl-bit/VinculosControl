import { z } from 'zod';

/**
 * Reglas del centro = columnas de `configuracion_centro` del ERP (snake_case).
 * Los rangos replican los CHECK de la BD del ERP (backend/prisma/migrations):
 * si el ERP cambia un CHECK, se cambia aqui. Todas opcionales: lo que no se
 * fija queda con el default del ERP.
 */
const entero = (min: number, max: number) => z.number().int().min(min).max(max);
const porcentaje = z.number().min(0).max(100);

export const MODELOS_COBRO = ['CENTRO', 'DIRECTO', 'MIXTO'] as const;
export const MEDIOS_CONFIRMACION = ['PAGO_EN_CENTRO', 'TRANSFERENCIA', 'PASARELA'] as const;
export const TIPOS_COMISION_DERIVACION = ['GENERAL', 'PORCENTAJE', 'MONTO_FIJO'] as const;

export const reglasSchema = z
  .object({
    rol_gestion_habilitado: z.boolean(),
    max_cuentas_madre: entero(1, 10),
    modelo_cobro: z.enum(MODELOS_COBRO),
    plazo_aviso_cancelacion_horas: entero(0, 720),
    penalizacion_cancelacion_porcentaje: porcentaje,
    cobro_inasistencia_porcentaje: porcentaje,
    comision_centro_porcentaje: porcentaje,
    margen_traslado_min: entero(0, 600),
    recordatorio_horas_antes: entero(0, 168),
    plazo_respuesta_derivacion_horas: entero(1, 8760),
    plazo_consentimiento_horas: entero(1, 8760),
    plazo_oposicion_horas: entero(1, 8760),
    dias_gracia_cierre: entero(0, 3650),
    comision_derivacion_tipo: z.enum(TIPOS_COMISION_DERIVACION),
    comision_derivacion_valor: z.number().min(0).max(1_000_000),
    liquidar_exige_evolucion: z.boolean(),
    liquidar_cargos_a_profesional: z.boolean(),
    match_filtro_directo: z.boolean(),
    dias_retencion_respuestas_match: entero(1, 365),
    minutos_retencion_solicitud: entero(5, 120),
    horas_aprobacion_solicitud: entero(1, 168),
    retencion_mensajes_dias: entero(30, 3650),
    edad_minima_cuenta: entero(14, 18),
    medios_pago_habilitados: z.array(z.enum(MEDIOS_CONFIRMACION)).min(1).max(3),
    plazo_validacion_transferencia_horas: entero(1, 168),
    porcentaje_pago_confirmacion: entero(1, 100),
    horas_plazo_pago_equipo: entero(0, 168),
    dias_gracia_morosidad: entero(0, 90),
    bloquear_agenda_morosos: z.boolean(),
  })
  .partial()
  .strict()
  .superRefine((r, ctx) => {
    // CHECK configuracion_centro_recordatorio_antes_de_cancelacion (con los defaults del ERP: aviso 24, recordatorio 48).
    const aviso = r.plazo_aviso_cancelacion_horas ?? 24;
    const recordatorio = r.recordatorio_horas_antes ?? 48;
    if (recordatorio !== 0 && recordatorio <= aviso)
      ctx.addIssue({ code: 'custom', path: ['recordatorio_horas_antes'], message: 'Debe ser 0 (sin recordatorio) o mayor que plazo_aviso_cancelacion_horas' });
    // CHECK configuracion_centro_comision_derivacion.
    const v = r.comision_derivacion_valor;
    if (v !== undefined && r.comision_derivacion_tipo === 'PORCENTAJE' && v > 100)
      ctx.addIssue({ code: 'custom', path: ['comision_derivacion_valor'], message: 'Con PORCENTAJE, maximo 100' });
    if (v !== undefined && r.comision_derivacion_tipo === 'MONTO_FIJO' && !Number.isInteger(v))
      ctx.addIssue({ code: 'custom', path: ['comision_derivacion_valor'], message: 'Con MONTO_FIJO, pesos enteros' });
    if (r.medios_pago_habilitados && new Set(r.medios_pago_habilitados).size !== r.medios_pago_habilitados.length)
      ctx.addIssue({ code: 'custom', path: ['medios_pago_habilitados'], message: 'Medios repetidos' });
  });

export type Reglas = z.infer<typeof reglasSchema>;
