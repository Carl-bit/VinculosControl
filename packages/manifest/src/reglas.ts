import { z } from 'zod';

/**
 * Reglas del centro = columnas de `configuracion_centro` del ERP (snake_case).
 * Los rangos replican los CHECK de la BD del ERP (backend/prisma/migrations):
 * si el ERP cambia un CHECK, se cambia aqui. Todas opcionales: lo que no se
 * fija queda con el default del ERP. Sin reglas de cobros: el MVP no maneja
 * pagos ni finanzas (2026-11-16) y esas columnas salieron del ERP.
 */
const entero = (min: number, max: number) => z.number().int().min(min).max(max);

export const reglasSchema = z
  .object({
    rol_gestion_habilitado: z.boolean(),
    max_cuentas_madre: entero(1, 10),
    plazo_aviso_cancelacion_horas: entero(0, 720),
    margen_traslado_min: entero(0, 600),
    recordatorio_horas_antes: entero(0, 168),
    plazo_respuesta_derivacion_horas: entero(1, 8760),
    plazo_consentimiento_horas: entero(1, 8760),
    plazo_oposicion_horas: entero(1, 8760),
    dias_gracia_cierre: entero(0, 3650),
    match_filtro_directo: z.boolean(),
    dias_retencion_respuestas_match: entero(1, 365),
    minutos_retencion_solicitud: entero(5, 120),
    horas_aprobacion_solicitud: entero(1, 168),
    retencion_mensajes_dias: entero(30, 3650),
    edad_minima_cuenta: entero(14, 18),
  })
  .partial()
  .strict()
  .superRefine((r, ctx) => {
    // CHECK configuracion_centro_recordatorio_antes_de_cancelacion (con los defaults del ERP: aviso 24, recordatorio 48).
    const aviso = r.plazo_aviso_cancelacion_horas ?? 24;
    const recordatorio = r.recordatorio_horas_antes ?? 48;
    if (recordatorio !== 0 && recordatorio <= aviso)
      ctx.addIssue({ code: 'custom', path: ['recordatorio_horas_antes'], message: 'Debe ser 0 (sin recordatorio) o mayor que plazo_aviso_cancelacion_horas' });
  });

export type Reglas = z.infer<typeof reglasSchema>;
