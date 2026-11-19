/**
 * Ejecutor de silos del host B (opcion C, aprobada 2026-11-12).
 *
 * - Unico proceso con /var/run/docker.sock. El agente no tiene Docker con escritura:
 *   le pide verbos al ejecutor por HTTP en una red interna, con su propio token.
 * - Rutas fijas, sin parametros libres (solo eliminar lleva cuerpo: { actaHash }):
 *     GET  /v1/silos/<slug>/estado
 *     POST /v1/silos/<slug>/reiniciar
 *     POST /v1/silos/<slug>/conectar_borde   (R11)
 *     POST /v1/silos/<slug>/soltar_borde     (R11)
 *     POST /v1/bordes/reconectar             (R11)
 *     POST /v1/silos/<slug>/detener          (B: para, no borra)
 *     POST /v1/silos/<slug>/reanudar         (B: arranca lo detenido)
 *     POST /v1/silos/<slug>/eliminar         (C: { actaHash } + consentimiento bajas/<slug>)
 *     POST /v1/silos/<slug>/preparar         (P0 imagen, P2, P3: { version, dominio, nombre, tema })
 *     POST /v1/silos/<slug>/levantar         (P4 / P6: { fase: "bd" | "todo" })
 *     POST /v1/silos/<slug>/respaldar        (ACTUALIZAR U1: respaldo cifrado sin leer la llave)
 *     POST /v1/silos/<slug>/actualizar       (ACTUALIZAR U2: { version }, guarda anterior.env)
 *     POST /v1/silos/<slug>/revertir         (ACTUALIZAR: vuelve a anterior.env)
 *     POST /v1/silos/<slug>/cargar_demo      (R10: { cuentasMadre, profesionales, pacientes, nombre }; solo EJECUTOR_DEMOS)
 *     POST /v1/silos/<slug>/resembrar_demo   (R10: proximas horas del demo, sin borrar nada; solo EJECUTOR_DEMOS)
 *     POST /v1/silos/<slug>/eliminar_demo    (demo vencido: detiene y borra; solo EJECUTOR_DEMOS con ES_DEMO=true)
 * - A quien se une a las redes de borde lo fija EJECUTOR_UNIR_BORDE del .env del
 *   host B (Traefik y el agente), nunca el plano de control.
 * - Una operacion de escritura a la vez.
 * - Auditoria local: cada verbo de escritura queda en EJECUTOR_LOG (JSON por linea, solo agregar).
 */
import { timingSafeEqual } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { actualizar, respaldar, revertir, validarVersion } from './actualizar';
import { argsCompose, type Config, leerVariables, levantar, MARCA, preparar, validarConfig, validarFase, validarPedido } from './aprovisionar';
import { conPrevia, detener, discoReal, eliminar, eliminarDemo, HASH, reanudar } from './ciclo';
import { cargarDemo, resembrarDemo, slugsDemo, validarPedidoDemo } from './demo';
import { docker, dockerApr, dockerCiclo } from './docker';
import { composeReal, discoSilosReal, tuberiaReal } from './silos';
import { conectarBorde, contenedoresBorde, ErrorVerbo, estado, reconectarBordes, reiniciar, soltarBorde } from './verbos';

const TOKEN = Buffer.from(process.env.EJECUTOR_TOKEN ?? '');
const PUERTO = Number(process.env.PUERTO ?? 7070);
const LOG = process.env.EJECUTOR_LOG ?? '/var/log/ejecutor/verbos.jsonl';
const UNIR_BORDE = contenedoresBorde(process.env.EJECUTOR_UNIR_BORDE);
/** R10: slugs de demostracion (lista del host B, nunca del plano de control). Solo ellos llevan ES_DEMO y los verbos de demo. */
const DEMOS = slugsDemo(process.env.EJECUTOR_DEMOS);
/** Consentimiento local de bajas (solo lectura) y respaldos del host (ver ciclo.ts). Sin ellos, eliminar no corre. */
const BAJAS_DIR = process.env.EJECUTOR_BAJAS_DIR ?? '';
const RESPALDOS_DIR = process.env.EJECUTOR_RESPALDOS_DIR ?? '';
/**
 * Aprovisionamiento (R1): sin EJECUTOR_ERP_INFRA, EJECUTOR_SILOS_DIR,
 * EJECUTOR_IMAGENES_DIR y EJECUTOR_TOKENS_DIR, preparar y levantar no corren.
 */
const APR = (() => {
  const e = process.env;
  if (!e.EJECUTOR_ERP_INFRA || !e.EJECUTOR_SILOS_DIR || !e.EJECUTOR_IMAGENES_DIR || !e.EJECUTOR_TOKENS_DIR) return null;
  const cfg: Config = validarConfig({
    erpInfra: e.EJECUTOR_ERP_INFRA,
    registro: e.EJECUTOR_REGISTRO ?? '127.0.0.1:5000',
    silosDir: e.EJECUTOR_SILOS_DIR,
    smtpUrl: e.EJECUTOR_SMTP_URL ?? '',
    sesConfigurationSet: e.EJECUTOR_SES_CONFIGURATION_SET ?? '',
  });
  const disco = discoSilosReal({
    silosDir: e.EJECUTOR_SILOS_DIR,
    imagenesDir: e.EJECUTOR_IMAGENES_DIR,
    tokensDir: e.EJECUTOR_TOKENS_DIR,
    plantilla: e.EJECUTOR_PLANTILLA ?? '/app/plantilla/silo.compose.tpl',
    uidAgente: Number(e.EJECUTOR_UID_AGENTE ?? 1000),
  });
  return { cfg, disco };
})();
/** Imagen del contenedor auxiliar que cifra los respaldos (la del propio ejecutor, con openssl). */
const AYUDANTE = process.env.EJECUTOR_IMAGEN_AYUDANTE ?? 'vinculos-agente-ejecutor:local';
const SIN_APR = 'aprovisionamiento deshabilitado: faltan EJECUTOR_ERP_INFRA, EJECUTOR_SILOS_DIR, EJECUTOR_IMAGENES_DIR o EJECUTOR_TOKENS_DIR';
const RUTA_SILO = /^\/v1\/silos\/([^/]+)\/(estado|reiniciar|conectar_borde|soltar_borde|detener|reanudar|eliminar|preparar|levantar|respaldar|actualizar|revertir|cargar_demo|resembrar_demo|eliminar_demo)$/;
const RUTA_BORDES = '/v1/bordes/reconectar';

type Verbo = 'estado' | 'reiniciar' | 'conectar_borde' | 'soltar_borde' | 'reconectar_bordes' | 'detener' | 'reanudar' | 'eliminar' | 'preparar' | 'levantar' | 'respaldar' | 'actualizar' | 'revertir' | 'cargar_demo' | 'resembrar_demo' | 'eliminar_demo';

/** Cuerpo JSON acotado (eliminar, preparar, levantar). El resto de los verbos no lleva cuerpo. */
function leerJson(req: IncomingMessage, max: number): Promise<unknown> {
  return new Promise((ok, falla) => {
    let cuerpo = '';
    req.setEncoding('utf8');
    req.on('data', (d: string) => {
      cuerpo += d;
      if (cuerpo.length > max) {
        req.destroy();
        falla(new ErrorVerbo(413, 'cuerpo demasiado grande'));
      }
    });
    req.on('end', () => {
      try {
        ok(JSON.parse(cuerpo));
      } catch {
        falla(new ErrorVerbo(400, 'cuerpo JSON invalido'));
      }
    });
  });
}

/** Cuerpo de eliminar: solo { actaHash }, maximo 200 bytes. */
async function leerActaHash(req: IncomingMessage): Promise<string> {
  const j = (await leerJson(req, 200).catch((e) => {
    if (e instanceof ErrorVerbo && e.status === 413) throw e;
    return null;
  })) as Record<string, unknown> | null;
  const h = j?.actaHash;
  if (!j || typeof j !== 'object' || Object.keys(j).length !== 1 || typeof h !== 'string' || !HASH.test(h)) {
    throw new ErrorVerbo(400, 'se espera { actaHash: <sha256 hex> }');
  }
  return h;
}

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

async function escribir(verbo: Verbo, slug: string, req: IncomingMessage): Promise<{ log: string[]; inventario?: unknown }> {
  switch (verbo) {
    case 'detener':
      // Traefik y el agente salen de la red de borde antes de apagar (R11).
      return { log: [...(await soltarBorde(docker, slug, UNIR_BORDE)), ...(await detener(dockerCiclo, slug))] };
    case 'reanudar': {
      const log = await reanudar(dockerCiclo, slug);
      return { log: [...log, ...(UNIR_BORDE.length ? await conectarBorde(docker, slug, UNIR_BORDE) : ['EJECUTOR_UNIR_BORDE vacio: borde sin unir'])] };
    }
    case 'eliminar': {
      if (!BAJAS_DIR || !RESPALDOS_DIR) throw new ErrorVerbo(409, 'eliminar deshabilitado: faltan EJECUTOR_BAJAS_DIR o EJECUTOR_RESPALDOS_DIR');
      const actaHash = await leerActaHash(req);
      // El borde se suelta dentro de eliminar, solo si pasan todas las precondiciones.
      const r = await eliminar(dockerCiclo, discoReal(BAJAS_DIR, RESPALDOS_DIR, process.env.EJECUTOR_SILOS_DIR && process.env.EJECUTOR_TOKENS_DIR ? { silosDir: process.env.EJECUTOR_SILOS_DIR, tokensDir: process.env.EJECUTOR_TOKENS_DIR } : undefined), slug, actaHash, new Date(), () => soltarBorde(docker, slug, UNIR_BORDE));
      // Reintento tras un exito cuya respuesta se perdio: el log lleva lo que borro la corrida previa.
      return conPrevia(r, await readFile(LOG, 'utf8').catch(() => ''), slug);
    }
    case 'preparar': {
      if (!APR) throw new ErrorVerbo(409, SIN_APR);
      const pedido = validarPedido(await leerJson(req, 1024));
      // imagenes: version y digests que el agente reporta en P2 (el silo los guarda: tag + digest).
      return preparar(dockerApr, APR.disco, composeReal, APR.cfg, slug, pedido, DEMOS.includes(slug));
    }
    case 'levantar': {
      if (!APR) throw new ErrorVerbo(409, SIN_APR);
      const fase = validarFase(await leerJson(req, 100));
      const log = await levantar(APR.disco, composeReal, APR.cfg, slug, fase);
      // P6: con el silo completo arriba, Traefik y el agente entran a su red de borde (R11).
      if (fase === 'todo') log.push(...(UNIR_BORDE.length ? await conectarBorde(docker, slug, UNIR_BORDE) : ['EJECUTOR_UNIR_BORDE vacio: borde sin unir']));
      return { log };
    }
    // ACTUALIZAR (seccion 7): respaldo previo, cambio de imagen y vuelta atras.
    case 'respaldar': {
      if (!APR || !RESPALDOS_DIR) throw new ErrorVerbo(409, `${SIN_APR} o EJECUTOR_RESPALDOS_DIR`);
      return respaldar(APR.disco, tuberiaReal(APR.cfg, { respaldosDir: RESPALDOS_DIR, imagenAyudante: AYUDANTE }), slug);
    }
    case 'actualizar': {
      if (!APR) throw new ErrorVerbo(409, SIN_APR);
      const version = validarVersion(await leerJson(req, 100));
      return actualizar(dockerApr, APR.disco, composeReal, APR.cfg, slug, version);
    }
    case 'revertir': {
      if (!APR) throw new ErrorVerbo(409, SIN_APR);
      const r = await revertir(APR.disco, composeReal, APR.cfg, slug, argsCompose);
      // Recrear backend y frontend los saca del borde: Traefik y el agente vuelven a entrar.
      r.log.push(...(UNIR_BORDE.length ? await conectarBorde(docker, slug, UNIR_BORDE) : []));
      return r;
    }
    // R10: solo slugs de EJECUTOR_DEMOS; no borran nada.
    case 'cargar_demo': {
      if (!APR) throw new ErrorVerbo(409, SIN_APR);
      const pedido = validarPedidoDemo(await leerJson(req, 300));
      return cargarDemo(APR.disco, composeReal, APR.cfg, DEMOS, slug, pedido);
    }
    case 'resembrar_demo': {
      if (!APR) throw new ErrorVerbo(409, SIN_APR);
      return resembrarDemo(APR.disco, composeReal, APR.cfg, DEMOS, slug);
    }
    case 'eliminar_demo': {
      if (!APR || !RESPALDOS_DIR) throw new ErrorVerbo(409, `${SIN_APR} o EJECUTOR_RESPALDOS_DIR`);
      const silos = APR.disco;
      const esDemo = async (s: string) => {
        const env = await silos.leerEnv(s);
        if (env === null) return 'sin_env' as const;
        return env.startsWith(MARCA) && leerVariables(env).ES_DEMO === 'true' ? ('si' as const) : ('no' as const);
      };
      // Sin bajas/: el consentimiento de un demo es estar en EJECUTOR_DEMOS con ES_DEMO=true.
      const disco = discoReal(BAJAS_DIR || '/nonexistent', RESPALDOS_DIR, { silosDir: process.env.EJECUTOR_SILOS_DIR!, tokensDir: process.env.EJECUTOR_TOKENS_DIR! });
      const r = await eliminarDemo(dockerCiclo, disco, DEMOS, esDemo, slug, new Date(), () => soltarBorde(docker, slug, UNIR_BORDE));
      return conPrevia(r, await readFile(LOG, 'utf8').catch(() => ''), slug, 'eliminar_demo');
    }
    default:
      return { log: await escribirSimple(verbo, slug) };
  }
}

function escribirSimple(verbo: Verbo, slug: string): Promise<string[]> {
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
      const r = await escribir(verbo, slug, req);
      await auditar({ verbo, slug, ok: true, ms: Date.now() - inicio, ...(r.inventario ? { inventario: r.inventario } : {}) });
      return responder(res, 200, r);
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
  process.stdout.write(`ejecutor en :${PUERTO} (verbos: estado, reiniciar, conectar_borde, soltar_borde, reconectar_bordes, detener, reanudar, eliminar${BAJAS_DIR && RESPALDOS_DIR ? "" : " (deshabilitado)"}, eliminar_demo, preparar, levantar, respaldar, actualizar y revertir${APR ? '' : ' (deshabilitados)'}; borde: ${UNIR_BORDE.join(', ') || 'sin configurar'})\n`),
);
