import { createHash } from 'node:crypto';

/** JSON canonico: claves ordenadas, sin espacios. La misma revision da siempre el mismo texto. */
export function jsonCanonico(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
    .join(',')}}`;
}

/** sha256 (hex) del JSON canonico: el hash que registra cada revision y que el silo guarda como aplicada. */
export const hashManifiesto = (v: unknown): string => createHash('sha256').update(jsonCanonico(v)).digest('hex');
