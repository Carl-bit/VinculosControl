/**
 * Modulos de un centro = enum `modulo_centro` del ERP. `nucleo` (seguridad,
 * usuarios, roles) es implicito y siempre activo: no figura aqui.
 *
 * Dependencias (CONTEXTO.md seccion 6):
 * - MATCH requiere EQUIPO (AGENDA opcional). CHECK en la BD del ERP.
 * - PAGINA_PUBLICA requiere EQUIPO (AGENDA y MATCH opcionales). Solo en el plano de control.
 * - WHATSAPP apagado por defecto, sin dependencia definida (post-MVP).
 *
 * Sin COBROS (2026-11-16): el MVP no maneja pagos ni finanzas y el modulo salio
 * del ERP (enum, tablas y funciones). Volver a tenerlo seria un modulo nuevo.
 */
export const MODULOS = ['FICHAS', 'AGENDA', 'EQUIPO', 'MATCH', 'PAGINA_PUBLICA', 'WHATSAPP'] as const;
export type Modulo = (typeof MODULOS)[number];

/**
 * Modulos que se ofrecen hoy (MVP): sin WHATSAPP (post-MVP). El enum completo
 * sigue en MODULOS porque es el del ERP.
 */
export const MODULOS_MVP = ['FICHAS', 'AGENDA', 'EQUIPO', 'MATCH', 'PAGINA_PUBLICA'] as const satisfies readonly Modulo[];
export type ModuloMvp = (typeof MODULOS_MVP)[number];

export const DEPENDENCIAS: Record<Modulo, { requiere: Modulo[]; opcional: Modulo[] }> = {
  FICHAS: { requiere: [], opcional: [] },
  AGENDA: { requiere: [], opcional: [] },
  EQUIPO: { requiere: [], opcional: [] },
  MATCH: { requiere: ['EQUIPO'], opcional: ['AGENDA'] },
  PAGINA_PUBLICA: { requiere: ['EQUIPO'], opcional: ['AGENDA', 'MATCH'] },
  WHATSAPP: { requiere: [], opcional: [] },
};

export const NOMBRE_MODULO: Record<Modulo, string> = {
  FICHAS: 'Fichas y pacientes',
  AGENDA: 'Agenda y espacios',
  EQUIPO: 'Equipo y perfiles',
  MATCH: 'Match terapeutico',
  PAGINA_PUBLICA: 'Pagina publica',
  WHATSAPP: 'Avisos por WhatsApp',
};

/** Orden canonico (el de MODULOS), sin repetidos. */
export const ordenarModulos = (sel: readonly Modulo[]): Modulo[] => MODULOS.filter((m) => sel.includes(m));

export interface FaltaRequisito {
  modulo: Modulo;
  falta: Modulo;
}

/** Valida que cada modulo elegido tenga sus requisitos. Lo usan la consola, el sitio y P0. */
export function validarModulos(sel: readonly Modulo[]): { ok: boolean; faltan: FaltaRequisito[] } {
  const faltan: FaltaRequisito[] = [];
  for (const m of ordenarModulos(sel)) for (const r of DEPENDENCIAS[m].requiere) if (!sel.includes(r)) faltan.push({ modulo: m, falta: r });
  return { ok: faltan.length === 0, faltan };
}

/** Agrega los requisitos que falten ("las dependencias se agregan solas"). */
export function completarDependencias(sel: readonly Modulo[]): Modulo[] {
  const set = new Set<Modulo>(sel);
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const m of [...set]) for (const r of DEPENDENCIAS[m].requiere) if (!set.has(r)) (set.add(r), (cambio = true));
  }
  return ordenarModulos([...set]);
}

/** Quitar un modulo: no se puede si otro modulo activo lo requiere (CONTEXTO.md seccion 6). */
export function quitarModulo(sel: readonly Modulo[], m: Modulo): { ok: true; modulos: Modulo[] } | { ok: false; requeridoPor: Modulo[] } {
  const requeridoPor = sel.filter((x) => x !== m && DEPENDENCIAS[x].requiere.includes(m));
  if (requeridoPor.length) return { ok: false, requeridoPor: ordenarModulos(requeridoPor) };
  return { ok: true, modulos: ordenarModulos(sel.filter((x) => x !== m)) };
}
