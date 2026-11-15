import { type NextRequest, NextResponse } from 'next/server';

/*
 * Proxy de la landing hacia la API: solo /landing/* (solicitudes de fase 1 y
 * enlace privado de fase 2). Agrega LANDING_SECRETO (distinto del de la
 * consola) y la IP del visitante para los limites por IP. Nada de la consola
 * pasa por aqui.
 */
const API = process.env.API_URL ?? 'http://127.0.0.1:4000';
const SECRETO = process.env.LANDING_SECRETO ?? '';

export const json = (cuerpo: unknown, status: number) => NextResponse.json(cuerpo, { status, headers: { 'cache-control': 'no-store' } });

function ipVisitante(req: NextRequest): string | null {
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null;
}

function mismoOrigen(req: NextRequest): boolean {
  const origen = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return !!origen && new URL(origen).host === host;
  } catch {
    return false;
  }
}

/** Reenvia a `${API}/landing/${ruta}`. Las escrituras exigen mismo origen, JSON y un cuerpo acotado. */
export async function reenviar(req: NextRequest, ruta: string, maxCuerpo: number) {
  const headers: Record<string, string> = { 'x-landing-secreto': SECRETO };
  const ip = ipVisitante(req);
  if (ip) headers['x-landing-ip'] = ip;
  let body: string | undefined;
  if (req.method !== 'GET') {
    if (!mismoOrigen(req)) return json({ mensaje: 'Origen no permitido' }, 403);
    if (!(req.headers.get('content-type') ?? '').startsWith('application/json')) return json({ mensaje: 'Formato no permitido' }, 415);
    body = await req.text();
    if (body.length > maxCuerpo) return json({ mensaje: 'Datos demasiado grandes' }, 413);
    headers['content-type'] = 'application/json';
  }
  try {
    const r = await fetch(`${API}/landing/${ruta}`, { method: req.method, headers, body, cache: 'no-store' });
    return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return json({ mensaje: 'No pudimos conectarnos ahora. Intenta en unos minutos.' }, 503);
  }
}
