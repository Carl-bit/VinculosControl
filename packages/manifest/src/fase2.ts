import { z } from 'zod';

import { manifiestoSchema, rutValido, TIPOS_ENTIDAD, CANALES_DEMO, TEMAS, type Manifiesto } from './manifiesto';
import { MODULOS, MODULOS_MVP, validarModulos } from './modulos';
import { reglasSchema } from './reglas';

/**
 * Fase 2 (CONTEXTO.md seccion 3): datos formales despues de la reunion.
 * Editable por ambas partes hasta APROBADO:
 * - El centro, por su enlace privado: entidad, responsables, dominio, modulos, color de marca.
 * - El operador, en la consola: todo lo anterior + version, reglas y contrato.
 *
 * Se guarda como "borrador" (todo opcional) en cada revision. P0 = armar el
 * manifiesto completo desde el borrador + slug y validarlo con manifiestoSchema.
 */

const texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const correo = z.string().trim().toLowerCase().email().max(200);
const persona = z.object({ nombre: texto(2, 120), correo }).strict();
const personaBorrador = z.object({ nombre: z.string().trim().max(120), correo: z.string().trim().toLowerCase().max(200) }).partial().strict();

/** Lo que completa el centro, ya listo para enviar (marca DATOS_COMPLETOS). */
export const datosCentroSchema = z
  .object({
    centro: z
      .object({
        nombre: texto(2, 120),
        razon_social: texto(2, 200),
        rut: z.string().refine(rutValido, 'RUT invalido'),
        tipo_entidad: z.enum(TIPOS_ENTIDAD),
        direccion: texto(0, 200).optional(),
        admin: persona,
        responsable_datos: persona,
        custodio: z.object({ nombre: texto(2, 120), rol: texto(2, 80) }).strict().optional(),
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
    /** MVP: sin WHATSAPP. */
    modulos: z.array(z.enum(MODULOS_MVP)).superRefine((sel, ctx) => {
      for (const f of validarModulos(sel).faltan) ctx.addIssue({ code: 'custom', message: `${f.modulo} requiere ${f.falta}` });
    }),
    estilo: z
      .object({ tema: z.enum(TEMAS).optional(), marca: z.object({ principal: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color #RRGGBB') }).strict().optional() })
      .strict()
      .optional(),
  })
  .strict();

export type DatosCentro = z.infer<typeof datosCentroSchema>;

/** Borrador guardado en cada revision de fase 2: todo opcional (se guarda a medias). */
export const borradorSchema = z
  .object({
    centro: z
      .object({
        nombre: z.string().trim().max(120),
        razon_social: z.string().trim().max(200),
        rut: z.string().trim().max(14),
        tipo_entidad: z.enum(TIPOS_ENTIDAD),
        direccion: z.string().trim().max(200),
        admin: personaBorrador,
        responsable_datos: personaBorrador,
        custodio: z.object({ nombre: z.string().trim().max(120), rol: z.string().trim().max(80) }).partial().strict(),
      })
      .partial()
      .strict(),
    dominio: z.object({ tipo: z.enum(['subdominio', 'propio']), valor: z.string().trim().toLowerCase().max(253) }).partial().strict(),
    modulos: z.array(z.enum(MODULOS)).max(MODULOS.length),
    estilo: z.object({ tema: z.enum(TEMAS), marca: z.object({ principal: z.string().max(7) }).partial().strict() }).partial().strict(),
    // Solo el operador:
    version: z.union([z.object({ canal: z.enum(CANALES_DEMO) }).strict(), z.object({ fija: z.string().max(20) }).strict()]),
    reglas: reglasSchema,
    legal: z.object({ contrato_encargo: z.object({ version: z.string().trim().max(40), firmado_en: z.string().max(10) }).partial().strict() }).partial().strict(),
    demo: z.object({ cuentas_madre: z.number().int(), profesionales: z.number().int(), pacientes: z.number().int() }).strict(),
  })
  .partial()
  .strict();

export type Borrador = z.infer<typeof borradorSchema>;

/** Campos que el centro puede tocar por su enlace (el resto del borrador lo conserva el operador). */
export const CAMPOS_CENTRO = ['centro', 'dominio', 'modulos', 'estilo'] as const;

/** Borrador que manda el centro: solo sus campos. */
export const borradorCentroSchema = borradorSchema.pick({ centro: true, dominio: true, modulos: true, estilo: true });

/** Mezcla lo que manda el centro sobre el borrador vigente, sin tocar version, reglas ni legal. */
export function mezclarBorradorCentro(vigente: Borrador, delCentro: z.infer<typeof borradorCentroSchema>): Borrador {
  const r: Borrador = { ...vigente };
  for (const k of CAMPOS_CENTRO) if (delCentro[k] !== undefined) (r as Record<string, unknown>)[k] = delCentro[k];
  // El estilo se mezcla por campo: si el centro solo manda su color, se conserva el tema que fijo el operador.
  if (delCentro.estilo) r.estilo = { ...vigente.estilo, ...delCentro.estilo };
  return r;
}

/** Arma el manifiesto completo (schema 1) desde el borrador y el slug. No valida: eso es P0. */
export function armarManifiesto(b: Borrador, slug: string | null): Record<string, unknown> {
  const marca = b.estilo?.marca?.principal;
  return {
    schema: 1,
    tipo_cliente: 'centro',
    centro: { ...b.centro, id: slug ?? undefined },
    dominio: b.dominio,
    version: b.version ?? { canal: 'estable' },
    estilo: { tema: b.estilo?.tema ?? 'moderno', ...(marca ? { marca: { principal: marca } } : {}) },
    modulos: b.modulos,
    reglas: b.reglas ?? {},
    legal: b.legal,
    ...(b.demo ? { demo: b.demo } : {}),
  };
}

export interface ResultadoP0 {
  ok: boolean;
  errores: string[];
  manifiesto?: Manifiesto;
}

/**
 * P0: valida el manifiesto armado (schema completo, dependencias, rangos del ERP)
 * y lo que exige aprobar en el MVP: modulos del MVP y contrato de encargo firmado.
 * La misma funcion corre en la consola (antes de aprobar) y en el job aprovisionar.
 */
export function validarP0(b: Borrador, slug: string | null): ResultadoP0 {
  const errores: string[] = [];
  if (!slug) errores.push('Falta el slug del centro');
  const r = manifiestoSchema.safeParse(armarManifiesto(b, slug));
  if (!r.success) for (const i of r.error.issues) errores.push(`${i.path.join('.') || 'manifiesto'}: ${i.message}`);
  for (const m of b.modulos ?? []) if (!(MODULOS_MVP as readonly string[]).includes(m)) errores.push(`modulos: ${m} no se ofrece en el MVP`);
  const c = b.legal?.contrato_encargo;
  if (!c?.version || !c.firmado_en) errores.push('legal: falta la version y la fecha del contrato de encargo firmado');
  const unicos = [...new Set(errores)];
  return unicos.length || !r.success ? { ok: false, errores: unicos } : { ok: true, errores: [], manifiesto: r.data };
}

/** Prellenado del borrador desde la fase 1 (nombre y modulos de interes). */
export function borradorDesdeFase1(f1: { nombre_centro?: string; modulos_interes?: string[]; estilo_preferido?: string } | null): Borrador {
  const mods = (f1?.modulos_interes ?? []).filter((m): m is (typeof MODULOS_MVP)[number] => (MODULOS_MVP as readonly string[]).includes(m));
  // La preferencia pasa como tema solo si esta implementado en el ERP; editorial (disenado, sin implementar), propios o aun_no_se los define el operador.
  const tema = TEMAS.find((t) => t === f1?.estilo_preferido);
  return { centro: { nombre: f1?.nombre_centro }, modulos: mods, ...(tema ? { estilo: { tema } } : {}) };
}

/** Slug sugerido desde el nombre: "Centro Kibou" -> "kibou". */
export function sugerirSlug(nombre: string): string {
  const base = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(centro|de|del|la|el|los|las|psicologia|psicologico|salud|mental|spa)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return /^[a-z]/.test(base) && base.length >= 3 ? base : `centro-${base || 'nuevo'}`.slice(0, 40);
}
