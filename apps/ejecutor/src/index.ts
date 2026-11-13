/**
 * Ejecutor de silos del host B (opcion C, aprobada 2026-11-12).
 *
 * - Unico proceso con /var/run/docker.sock. El agente no tiene Docker con escritura:
 *   le pide verbos al ejecutor por HTTP en una red interna, con su propio token.
 * - Rutas fijas, sin cuerpo ni parametros libres:
 *     GET  /v1/silos/<slug>/estado
 *     POST /v1/silos/<slug>/reiniciar
 *     POST /v1/silos/<slug>/conectar_borde   (R11)
 *     POST /v1/silos/<slug>/soltar_borde     (R11)
 *     POST /v1/bordes/reconectar             (R11)
 * - A quien se une a las redes de borde lo fija EJECUTOR_UNIR_BORDE del .env del
 *   host B (Traefik y el agente), nunca el plano de control.
 * - Una operacion de escritura a la vez.
 * - Auditoria local: cada verbo de escritura queda en EJECUTOR_LOG (JSON por linea, solo agregar).
 */
import { timingSafeEqual } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { docker } from './docker';
import { conectarBorde, contenedoresBorde, ErrorVerbo, estado, reconectarBordes, reiniciar, soltarBorde } from './verbos';

const TOKEN = Buffer.from(process.env.EJECUTOR_TOKEN ?? '');
const PUERTO = Number(process.env.PUERTO ?? 7070);
const LOG = process.env.EJECUTOR_LOG ?? '/var/log/ejecutor/verbos.jsonl';
const UNIR_BORDE = contenedoresBorde(process.env.EJECUTOR_UNIR_BORDE);
const RUTA_SILO = /^\/v1\/silos\/([^/]+)\/(estado|reiniciar|conectar_borde|soltar_borde)$/;
const RUTA_BORDES = '/v1/bordes/reconectar';

type Verbo = 'estado' | 'reiniciar' | 'conectar_borde' | 'soltar_borde' | 'reconectar_bordes';

let ocupado = false;

const responder = (res: ServerResponse, status: number, cuerpo: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(cuerpo));
};

function autorizado(req: IncomingMessage): boolean {
  const t = Buffer.from(/^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '');
  return TOKEN.length >= 32 && t.length === TOKEN.length && timingSafeEqual(t, TOKEN);
}

async function auditar(registro: Record<string, unknown>) {
  try {
    await appendFile(LOG, `${JSON.stringify({ en: new Date().toISOString(), ...registro })}\n`);
  } catch (e) {
    process.stderr.write(`no se pudo escribir la auditoria: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

/** Verbo y slug de la ruta, o null si no es una ruta conocida con su metodo. */
function rutear(req: IncomingMessage): { verbo: Verbo; slug: string } | null {
  if (req.url === RUTA_BORDES) return req.method === 'POST' ? { verbo: 'reconectar_bordes', slug: '*' } : null;
  const m = RUTA_SILO.exec(req.url ?? '');
  if (!m) return null;
  const verbo = m[2] as Verbo;
  if ((verbo === 'estado') !== (req.method === 'GET')) return null;
  if (req.method !== 'GET' && req.method !== 'POST') return null;
  return { verbo, slug: decodeURIComponent(m[1]) };
}

function escribir(verbo: Verbo, slug: string): Promise<string[]> {
  switch (verbo) {
    case 'reiniciar':
      return reiniciar(docker, slug);
    case 'conectar_borde':
      return conectarBorde(docker, slug, UNIR_BORDE);
    case 'soltar_borde':
      return soltarBorde(docker, slug, UNIR_BORDE);
    case 'reconectar_bordes':
      return reconectarBordes(docker, UNIR_BORDE);
    default:
      throw new ErrorVerbo(404, 'verbo desconocido');
  }
}

const servidor = createServer(async (req, res) => {
  const inicio = Date.now();
  if (!autorizado(req)) return responder(res, 401, { error: 'no autorizado' });
  const ruta = rutear(req);
  if (!ruta) return responder(res, 404, { error: 'verbo desconocido' });
  const { verbo, slug } = ruta;
  try {
    if (verbo === 'estado') return responder(res, 200, { contenedores: await estado(docker, slug) });
    if (ocupado) return responder(res, 409, { error: 'otra operacion en curso' });
    ocupado = true;
    try {
      const log = await escribir(verbo, slug);
      await auditar({ verbo, slug, ok: true, ms: Date.now() - inicio });
      return responder(res, 200, { log });
    } finally {
      ocupado = false;
    }
  } catch (e) {
    const status = e instanceof ErrorVerbo ? e.status : 500;
    const error = e instanceof Error ? e.message : String(e);
    if (verbo !== 'estado') await auditar({ verbo, slug, ok: false, error, ms: Date.now() - inicio });
    return responder(res, status, { error });
  }
});

if (TOKEN.length < 32) {
  process.stderr.write('Falta EJECUTOR_TOKEN (32+ caracteres)\n');
  process.exit(1);
}
servidor.listen(PUERTO, '0.0.0.0', () =>
  process.stdout.write(`ejecutor en :${PUERTO} (verbos: estado, reiniciar, conectar_borde, soltar_borde, reconectar_bordes; borde: ${UNIR_BORDE.join(', ') || 'sin configurar'})\n`),
);
