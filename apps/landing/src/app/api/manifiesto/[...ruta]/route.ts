import type { NextRequest } from 'next/server';

import { json, reenviar } from '../../proxy';

/*
 * Enlace privado de fase 2 (/manifiesto/<token> de la landing):
 *   GET|PUT  /api/manifiesto/<token>          -> /landing/manifiesto/<token>
 *   POST     /api/manifiesto/<token>/enviar   -> /landing/manifiesto/<token>/enviar
 * Cualquier otra forma: 404 sin llamar a la API.
 */
const TOKEN = /^[\w-]{43}$/;

type Ctx = { params: Promise<{ ruta: string[] }> };

async function ruta(req: NextRequest, { params }: Ctx) {
  const partes = (await params).ruta;
  const [token, accion] = partes;
  const valido = TOKEN.test(token ?? '') && ((partes.length === 1 && ['GET', 'PUT'].includes(req.method)) || (partes.length === 2 && accion === 'enviar' && req.method === 'POST'));
  if (!valido) return json({ mensaje: 'No encontrado' }, 404);
  return reenviar(req, `manifiesto/${partes.join('/')}`, 20_000);
}

export const GET = ruta;
export const PUT = ruta;
export const POST = ruta;
