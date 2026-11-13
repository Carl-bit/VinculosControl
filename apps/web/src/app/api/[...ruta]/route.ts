import { type NextRequest, NextResponse } from 'next/server';

/*
 * Proxy de la consola hacia la API: solo /consola/* y solo GET/POST.
 * - Agrega el secreto compartido (CONSOLA_SECRETO) que la API exige en esas
 *   rutas: la consola queda accesible solo a traves de esta web (127.0.0.1 o
 *   Cloudflare Access), aunque la API este publicada para el agente.
 * - Guarda la sesion en una cookie httpOnly (el navegador nunca ve el token) y
 *   la reenvia como x-consola-sesion.
 * - Reenvia la IP del navegador (cf-connecting-ip o x-forwarded-for) para la auditoria.
 */
const API = process.env.API_URL ?? 'http://127.0.0.1:4000';
const SECRETO = process.env.CONSOLA_SECRETO ?? '';
const COOKIE_SESION = 'vc_sesion';
const MAX_CUERPO = 10_000;
/** Rutas del login: un 401 ahi es un error de credenciales, no una sesion vencida. */
const LOGIN = new Set(['consola/acceso/credenciales', 'consola/acceso/codigo', 'consola/acceso/reenviar']);

const json = (cuerpo: unknown, status: number) => NextResponse.json(cuerpo, { status, headers: { 'cache-control': 'no-store' } });

function ipCliente(req: NextRequest): string | null {
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null;
}

/** POST solo desde la misma web (la cookie ya es SameSite=Strict; esto cierra el resto). */
function mismoOrigen(req: NextRequest): boolean {
  const origen = req.headers.get('origin');
  if (!origen) return false;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origen).host === host;
  } catch {
    return false;
  }
}

async function reenviar(req: NextRequest, partes: string[]) {
  if (partes[0] !== 'consola' || partes.some((p) => !/^[\w.-]+$/.test(p))) return json({ error: 'no encontrado' }, 404);
  const ruta = partes.join('/');
  const headers: Record<string, string> = { 'x-consola-secreto': SECRETO };
  const sesion = req.cookies.get(COOKIE_SESION)?.value;
  if (sesion) headers['x-consola-sesion'] = sesion;
  const ip = ipCliente(req);
  if (ip) headers['x-consola-ip'] = ip;

  let body: string | undefined;
  if (req.method === 'POST') {
    if (!mismoOrigen(req)) return json({ mensaje: 'Origen no permitido' }, 403);
    body = await req.text();
    if (body.length > MAX_CUERPO) return json({ mensaje: 'Cuerpo demasiado grande' }, 413);
    if (body) headers['content-type'] = 'application/json';
  }

  const r = await fetch(`${API}/${ruta}${req.nextUrl.search}`, { method: req.method, headers, body, cache: 'no-store' });
  let texto = r.status === 204 ? null : await r.text();
  const seguro = req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl.protocol === 'https:';

  // El token de la sesion nueva va a la cookie y se borra del cuerpo.
  let token: string | undefined;
  if (ruta === 'consola/acceso/codigo' && r.ok && texto) {
    const datos = JSON.parse(texto) as { token?: string };
    token = datos.token;
    delete datos.token;
    texto = JSON.stringify(datos);
  }

  const res = new NextResponse(texto, {
    status: r.status,
    headers: { 'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
  });
  if (token) {
    res.cookies.set(COOKIE_SESION, token, { httpOnly: true, sameSite: 'strict', secure: seguro, path: '/', maxAge: 12 * 3600 });
  } else if (ruta === 'consola/acceso/salir' || (r.status === 401 && !LOGIN.has(ruta))) {
    res.cookies.set(COOKIE_SESION, '', { httpOnly: true, sameSite: 'strict', secure: seguro, path: '/', maxAge: 0 });
  }
  return res;
}

type Ctx = { params: Promise<{ ruta: string[] }> };
export const GET = async (req: NextRequest, { params }: Ctx) => reenviar(req, (await params).ruta);
export const POST = async (req: NextRequest, { params }: Ctx) => reenviar(req, (await params).ruta);
