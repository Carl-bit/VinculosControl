import { z } from 'zod';

import { MODULOS_MVP } from './modulos';

/**
 * Fase 1: formulario publico del sitio (CONTEXTO.md seccion 3). Sin datos
 * sensibles: solo el contacto comercial y como trabaja el centro hoy.
 */
export const TAMANOS_EQUIPO = ['1 a 5', '6 a 15', '16 a 40', 'mas de 40'] as const;
export const SITIO_EXISTENTE = ['integrar', 'nuevo', 'no_necesito'] as const;
/**
 * Preferencia de estilo del centro (no es el tema final: ese lo fija el
 * manifiesto con un tema que exista en el ERP). "propios" = el centro trae sus
 * colores; "aun_no_se" = se define en la primera sesion.
 */
export const ESTILOS_FASE1 = ['moderno', 'cuaderno', 'editorial', 'propios', 'aun_no_se'] as const;

const texto = (min: number, max: number) => z.string().trim().min(min).max(max);

export const fase1Schema = z
  .object({
    nombre_centro: texto(2, 120),
    contacto: z
      .object({
        nombre: texto(2, 120),
        correo: z.string().trim().toLowerCase().email().max(200),
        telefono: z
          .string()
          .trim()
          .regex(/^\+?[0-9 ]{8,16}$/, 'Telefono: solo numeros, espacios y + inicial')
          .optional()
          .or(z.literal('').transform(() => undefined)),
      })
      .strict(),
    comuna: texto(2, 80),
    region: texto(2, 80).optional(),
    tamano_equipo: z.enum(TAMANOS_EQUIPO),
    /** Solo los modulos del MVP: el formulario no ofrece COBROS ni WHATSAPP. */
    modulos_interes: z.array(z.enum(MODULOS_MVP)).max(MODULOS_MVP.length),
    sitio_existente: z.enum(SITIO_EXISTENTE),
    estilo_preferido: z.enum(ESTILOS_FASE1),
    como_trabajan_hoy: texto(0, 300).optional(),
    comentarios: texto(0, 1000).optional(),
  })
  .strict();

export type Fase1 = z.infer<typeof fase1Schema>;
