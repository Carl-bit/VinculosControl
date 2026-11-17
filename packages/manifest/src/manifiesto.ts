import { z } from 'zod';

import { MODULOS, validarModulos } from './modulos';
import { reglasSchema } from './reglas';

/**
 * Manifiesto completo (schema 1). Lo arma la fase 2 sobre la fase 1 y es la
 * entrada del job `aprovisionar` (P0 lo vuelve a validar). Cada cambio aprobado
 * es una revision nueva con su hash (hashManifiesto).
 *
 * Pendiente (no se inventa): `semilla` (horario, tipos de atencion) se define
 * contra las tablas del ERP cuando se construya P6.
 */
export const TIPOS_ENTIDAD = ['sociedad_profesionales', 'spa', 'eirl', 'persona_natural', 'otra'] as const;
export const CANALES = ['estable', 'beta'] as const;
/** Canal de los silos de demostracion (lo primero que recibe una version): solo con el bloque demo. */
export const CANALES_DEMO = ['demo', ...CANALES] as const;
/**
 * Temas implementados hoy en el ERP (frontend/src/app/temas, NEXT_PUBLIC_TEMA).
 * "editorial" esta disenado (boceto del landing) pero falta implementarlo en el
 * ERP (requisito R8): se agrega aqui cuando exista, si no el silo caeria en moderno.
 */
export const TEMAS = ['moderno', 'cuaderno'] as const;

export const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

const persona = z.object({ nombre: z.string().trim().min(2).max(120), correo: z.string().trim().toLowerCase().email().max(200) }).strict();

/** RUT chileno con digito verificador (modulo 11). Acepta puntos y guion. */
export function rutValido(rut: string): boolean {
  const limpio = rut.replace(/[.\s]/g, '').toUpperCase();
  const m = /^(\d{7,8})-?([\dK])$/.exec(limpio);
  if (!m) return false;
  let suma = 0;
  let factor = 2;
  for (const d of m[1].split('').reverse()) {
    suma += Number(d) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const r = 11 - (suma % 11);
  const dv = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return dv === m[2];
}

export const manifiestoSchema = z
  .object({
    schema: z.literal(1),
    tipo_cliente: z.literal('centro'),
    centro: z
      .object({
        id: z.string().regex(SLUG, 'Slug: minusculas, numeros y guiones (3 a 40)'),
        nombre: z.string().trim().min(2).max(120),
        razon_social: z.string().trim().min(2).max(200),
        rut: z.string().refine(rutValido, 'RUT invalido'),
        tipo_entidad: z.enum(TIPOS_ENTIDAD),
        direccion: z.string().trim().max(200).optional(),
        admin: persona,
        responsable_datos: persona,
        /** Custodio de la parte 2 de la llave de recuperacion: solo nombre y rol, nunca la parte. */
        custodio: z.object({ nombre: z.string().trim().min(2).max(120), rol: z.string().trim().min(2).max(80) }).strict().optional(),
      })
      .strict(),
    dominio: z
      .object({
        tipo: z.enum(['subdominio', 'propio']),
        valor: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, 'Dominio invalido'),
      })
      .strict(),
    version: z.union([z.object({ canal: z.enum(CANALES_DEMO) }).strict(), z.object({ fija: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict()]),
    estilo: z
      .object({
        tema: z.enum(TEMAS, { message: 'Tema no implementado en el ERP (hoy: moderno o cuaderno; editorial pendiente, R8)' }),
        marca: z.object({ principal: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict().optional(),
      })
      .strict(),
    modulos: z.array(z.enum(MODULOS)).superRefine((sel, ctx) => {
      if (new Set(sel).size !== sel.length) ctx.addIssue({ code: 'custom', message: 'Modulos repetidos' });
      for (const f of validarModulos(sel).faltan) ctx.addIssue({ code: 'custom', message: `${f.modulo} requiere ${f.falta}` });
    }),
    reglas: reglasSchema.default({}),
    legal: z
      .object({
        contrato_encargo: z.object({ version: z.string().trim().min(1).max(40), firmado_en: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
      })
      .strict()
      .optional(),
    /**
     * Silo de demostracion (solo el operador): en P10 se generan datos ficticios
     * con estas cantidades en vez de invitar al ADMIN inicial. El host B solo lo
     * cumple si el slug esta en EJECUTOR_DEMOS.
     */
    demo: z
      .object({
        cuentas_madre: z.number().int().min(1).max(3),
        profesionales: z.number().int().min(1).max(20),
        pacientes: z.number().int().min(0).max(300),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if ('canal' in m.version && m.version.canal === 'demo' && !m.demo) ctx.addIssue({ code: 'custom', path: ['version', 'canal'], message: 'El canal demo es solo para silos de demostracion' });
  });

export type Manifiesto = z.infer<typeof manifiestoSchema>;

/** Limites del demo a medida (los mismos que el generador del ERP y el ejecutor). */
export const LIMITES_DEMO = { cuentas_madre: [1, 3], profesionales: [1, 20], pacientes: [0, 300] } as const;
