import { NextResponse } from 'next/server';

/**
 * Direccion publica de la landing (LANDING_URL, runtime). No es secreta: la usa
 * el boton "Compartir solicitud" para armar el enlace con ?via=enlace.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ url: (process.env.LANDING_URL ?? 'http://127.0.0.1:3300').replace(/\/$/, '') }, { headers: { 'cache-control': 'no-store' } });
}
