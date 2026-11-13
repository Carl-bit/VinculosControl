/**
 * Reglas del acceso a la consola (funciones puras, con tests en reglas.spec.ts).
 * Paso 1: correo + contrasena (5 fallos seguidos bloquean 15 min).
 * Paso 2: codigo de 6 digitos por correo (vence 10 min, un uso, 5 intentos).
 * Sesion: 30 min sin actividad o 12 h desde el inicio.
 */
import { createHmac, randomInt, scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';

export const LIMITES = {
  fallos: 5,
  bloqueoMin: 15,
  codigoMin: 10,
  intentosCodigo: 5,
  reenvioS: 45,
  reenviosMax: 3,
  inactividadMin: 30,
  sesionMaxH: 12,
  claveMin: 12,
} as const;

const MIN = 60_000;

// ---------- contrasenas (scrypt de node:crypto, sin dependencias nativas) ----------

const SCRYPT = { N: 16_384, r: 8, p: 1, largo: 64 };

/** Formato: scrypt$N$r$p$sal$hash (base64url). */
export function hashClave(clave: string): string {
  const sal = randomBytes(16);
  const h = scryptSync(clave, sal, SCRYPT.largo, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, sal.toString('base64url'), h.toString('base64url')].join('$');
}

export function verificarClave(clave: string, guardado: string): boolean {
  const [alg, n, r, p, sal, hash] = guardado.split('$');
  if (alg !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'base64url');
  const h = scryptSync(clave, Buffer.from(sal, 'base64url'), esperado.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(h, esperado);
}

/** Hash de relleno: se verifica contra el cuando el correo no existe, para que el tiempo de respuesta no lo delate. */
export const CLAVE_RELLENO = hashClave(randomBytes(16).toString('hex'));

// ---------- paso 1: credenciales ----------

export interface EstadoCuenta {
  activo: boolean;
  fallos: number;
  bloqueadaHasta: Date | null;
}

export type ResultadoCredenciales =
  /** Contrasena correcta: fallos a 0. */
  | { resultado: 'ok'; fallos: 0; bloqueadaHasta: null }
  /** Contrasena incorrecta (o cuenta inexistente/inactiva): suma un fallo. */
  | { resultado: 'invalida'; fallos: number; bloqueadaHasta: null }
  /** Este fallo fue el quinto: la cuenta queda bloqueada desde ahora. */
  | { resultado: 'bloqueo'; fallos: 0; bloqueadaHasta: Date }
  /** Ya estaba bloqueada: no se evalua la contrasena ni se cuenta el intento. */
  | { resultado: 'bloqueada'; fallos: number; bloqueadaHasta: Date };

export function evaluarCredenciales(cuenta: EstadoCuenta | null, claveOk: boolean, ahora: Date): ResultadoCredenciales {
  if (cuenta?.bloqueadaHasta && cuenta.bloqueadaHasta > ahora) return { resultado: 'bloqueada', fallos: cuenta.fallos, bloqueadaHasta: cuenta.bloqueadaHasta };
  if (!cuenta || !cuenta.activo) return { resultado: 'invalida', fallos: 0, bloqueadaHasta: null };
  if (claveOk) return { resultado: 'ok', fallos: 0, bloqueadaHasta: null };
  const fallos = cuenta.fallos + 1;
  if (fallos >= LIMITES.fallos) return { resultado: 'bloqueo', fallos: 0, bloqueadaHasta: new Date(ahora.getTime() + LIMITES.bloqueoMin * MIN) };
  return { resultado: 'invalida', fallos, bloqueadaHasta: null };
}

// ---------- paso 2: codigo por correo ----------

export const generarCodigo = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const generarId = () => randomBytes(24).toString('base64url');

/** HMAC con el secreto de la consola: una copia de la BD no basta para probar los 10^6 codigos. */
export const hmacCodigo = (secreto: string, desafioId: string, codigo: string) => createHmac('sha256', secreto).update(`${desafioId}:${codigo}`).digest('hex');

export function igualesHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export const venceCodigo = (ahora: Date) => new Date(ahora.getTime() + LIMITES.codigoMin * MIN);

export interface EstadoDesafio {
  venceEn: Date;
  usadoEn: Date | null;
  intentos: number;
}

export type ResultadoCodigo = 'ok' | 'invalido' | 'agotado' | 'vencido';

/** `intentos` es el numero de intentos fallidos previos. 'agotado' tambien cuando este fallo es el quinto. */
export function evaluarCodigo(d: EstadoDesafio | null, codigoOk: boolean, ahora: Date): ResultadoCodigo {
  if (!d || d.usadoEn || d.venceEn <= ahora) return 'vencido';
  if (d.intentos >= LIMITES.intentosCodigo) return 'agotado';
  if (codigoOk) return 'ok';
  return d.intentos + 1 >= LIMITES.intentosCodigo ? 'agotado' : 'invalido';
}

/** Segundos que faltan para poder reenviar (0 = ya se puede); null = no se puede (vencido, usado o sin reenvios). */
export function esperaReenvio(d: EstadoDesafio & { enviadoEn: Date; reenvios: number }, ahora: Date): number | null {
  if (d.usadoEn || d.venceEn <= ahora || d.reenvios >= LIMITES.reenviosMax) return null;
  return Math.max(0, Math.ceil((d.enviadoEn.getTime() + LIMITES.reenvioS * 1000 - ahora.getTime()) / 1000));
}

// ---------- sesion ----------

export interface EstadoSesion {
  creadaEn: Date;
  ultimaActividad: Date;
  revocadaEn: Date | null;
}

export function sesionVigente(s: EstadoSesion, ahora: Date): boolean {
  if (s.revocadaEn) return false;
  if (ahora.getTime() - s.ultimaActividad.getTime() >= LIMITES.inactividadMin * MIN) return false;
  return ahora.getTime() - s.creadaEn.getTime() < LIMITES.sesionMaxH * 60 * MIN;
}

// ---------- utilidades ----------

export const normalizarCorreo = (c: string) => c.trim().toLowerCase();

/** "charlie@vinculos.cl" -> "c••••••@vinculos.cl" (lo que muestra el paso 2). */
export function enmascararCorreo(correo: string): string {
  const [local, dominio] = correo.split('@');
  if (!local || !dominio) return '••••••';
  return `${local[0]}••••••@${dominio}`;
}

/** IP que manda el proxy de la web (cf-connecting-ip o x-forwarded-for). Solo se guarda si parece una IP. */
export function ipValida(v: unknown): string | null {
  return typeof v === 'string' && /^[0-9a-fA-F:.]{2,45}$/.test(v) ? v : null;
}
