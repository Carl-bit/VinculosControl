import { type NextRequest, NextResponse } from 'next/server';

/*
 * Proxy del sitio publico hacia la API (solo /publico/*):
 *   POST solicitudes                      formulario de fase 1
 *   GET|PUT manifiesto/<token>            enlace privado de fase 2
 *   POST manifiesto/<token>/enviar
 * Agrega SITIO_SECRETO (distinto del de la consola) y la IP del visitante
 * para los limites por IP. Nada de la consola pasa por aqui.
 */
const API = process.env.API_URL ?? 'http://127.0.0.1:4000';
const SECRETO = process.env.SITIO_SECRETO ?? '';
const MAX_CUERPO = 20_000;
const TOKEN = '[\\w-]{43}';
const RUTAS: { re: RegExp; metodos: string[] }[] = [
  { re: /^solicitudes$/, metodos: ['POST'] },
  { re: new RegExp(`^manifiesto/${TOKEN}$`), metodos: ['GET', 'PUT'] },
  { re: new RegExp(`^manifiesto/${TOKEN}/enviar$`), metodos: ['POST'] },
];

const json = (cuerpo: unknown, status: number) => NextResponse.json(cuerpo, { status, headers: { 'cache-control': 'no-store' } });

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

type Ctx = { params: Promise<{ ruta: string[] }> };

async function reenviar(req: NextRequest, { params }: Ctx) {
  const ruta = (await params).ruta.join('/');
  if (!RUTAS.some((r) => r.re.test(ruta) && r.metodos.includes(req.method))) return json({ mensaje: 'No encontrado' }, 404);
  const headers: Record<string, string> = { 'x-sitio-secreto': SECRETO };
  const ip = ipVisitante(req);
  if (ip) headers['x-sitio-ip'] = ip;
  let body: string | undefined;
  if (req.method !== 'GET') {
    if (!mismoOrigen(req)) return json({ mensaje: 'Origen no permitido' }, 403);
    body = await req.text();
    if (body.length > MAX_CUERPO) return json({ mensaje: 'Formulario demasiado grande' }, 413);
    headers['content-type'] = 'application/json';
  }
  try {
    const r = await fetch(`${API}/publico/${ruta}`, { method: req.method, headers, body, cache: 'no-store' });
    return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return json({ mensaje: 'No pudimos conectarnos ahora. Intenta en unos minutos.' }, 503);
  }
}

export const GET = reenviar;
export const PUT = reenviar;
export const POST = reenviar;
