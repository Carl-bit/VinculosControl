import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Acceso de un demo (decision del usuario 2026-11-19): la contrasena comun de
 * las cuentas ficticias del demo se guarda cifrada con AES-256-GCM. La llave
 * se deriva de CONSOLA_SECRETO con HKDF (contexto propio), asi un volcado de la
 * BD `control` sola no la revela. Solo demos: nunca credenciales de un centro.
 */

export interface CuentaDemo {
  rol: string;
  email: string;
}

const llave = (secreto: string) => Buffer.from(hkdfSync('sha256', secreto, 'vinculos-control', 'acceso-demo/v1', 32));

export function cifrarClave(secreto: string, clave: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', llave(secreto), iv);
  const cifrado = Buffer.concat([c.update(clave, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), cifrado].map((b) => b.toString('base64url')).join('.');
}

export function descifrarClave(secreto: string, guardado: string): string {
  const [iv, tag, cifrado] = guardado.split('.').map((x) => Buffer.from(x, 'base64url'));
  if (!iv || !tag || !cifrado) throw new Error('acceso del demo con formato invalido');
  const d = createDecipheriv('aes-256-gcm', llave(secreto), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(cifrado), d.final()]).toString('utf8');
}

/** Rol del ERP y correo del dominio ficticio del demo (<algo>@<slug>.demo.vinculos.cl). Cualquier otra cosa se descarta. */
export function cuentasValidas(slug: string, cuentas: CuentaDemo[]): CuentaDemo[] {
  const dominio = `@${slug}.demo.vinculos.cl`;
  return cuentas.filter((c) => /^[A-Z_]{2,30}$/.test(c.rol) && c.email.endsWith(dominio) && /^[a-z0-9._+-]{1,64}$/.test(c.email.slice(0, -dominio.length)));
}
