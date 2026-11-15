/**
 * Versionado semantico de las imagenes (CONTEXTO.md seccion 7). Funciones puras.
 * X.Y.Z o X.Y.Z-sufijo; un sufijo es anterior a la misma version sin sufijo.
 */
export const VERSION = /^([0-9]+)\.([0-9]+)\.([0-9]+)(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/;
export const CANALES = ['demo', 'beta', 'estable'] as const;
export type Canal = (typeof CANALES)[number];

function partes(v: string) {
  const m = VERSION.exec(v);
  if (!m) throw new Error(`version invalida: ${v}`);
  return { mayor: Number(m[1]), menor: Number(m[2]), parche: Number(m[3]), sufijo: m[4]?.slice(1) ?? null };
}

/** <0 si a es anterior a b, 0 si iguales, >0 si posterior. */
export function compararVersion(a: string, b: string): number {
  const x = partes(a);
  const y = partes(b);
  for (const k of ['mayor', 'menor', 'parche'] as const) if (x[k] !== y[k]) return x[k] - y[k];
  if (x.sufijo === y.sufijo) return 0;
  if (x.sufijo === null) return 1;
  if (y.sufijo === null) return -1;
  return x.sufijo.localeCompare(y.sufijo, 'en', { numeric: true });
}

/**
 * Tipo de salto de `desde` a `hacia`: patch (solo correcciones, se aplica sin
 * confirmar) o minor (en 0.x puede traer cambios incompatibles: confirmacion
 * por silo). Un cambio de mayor se trata como minor.
 */
export function tipoSalto(desde: string, hacia: string): 'patch' | 'minor' {
  const a = partes(desde);
  const b = partes(hacia);
  return a.mayor === b.mayor && a.menor === b.menor ? 'patch' : 'minor';
}

export const esPrueba = (v: string) => partes(v).sufijo !== null;

/** Orden de promocion: demo -> beta -> estable. Una version de prueba (con sufijo) no llega a estable. */
export function bloqueoPromocion(r: { version: string; enDemoEn: Date | null; enBetaEn: Date | null; conflicto: string | null }, canal: Canal): string | null {
  if (r.conflicto) return `La version ${r.version} tiene un conflicto de digests: no se promueve`;
  if (canal === 'beta' && !r.enDemoEn) return 'Primero en demo (demo -> beta -> estable)';
  if (canal === 'estable' && !r.enBetaEn) return 'Primero en beta (demo -> beta -> estable)';
  if (canal === 'estable' && esPrueba(r.version)) return 'Una version de prueba (con sufijo) no llega a estable';
  return null;
}
