import { NextResponse } from 'next/server';

/** Direccion publica del formulario de solicitud (SITIO_URL, runtime). No es secreta: la usa el boton "Compartir solicitud". */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ url: (process.env.SITIO_URL ?? 'http://127.0.0.1:3200').replace(/\/$/, '') }, { headers: { 'cache-control': 'no-store' } });
}
