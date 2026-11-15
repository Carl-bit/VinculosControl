import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  type Compose,
  type Config,
  type DiscoSilos,
  type DockerApr,
  imagenesDe,
  leerVariables,
  levantar,
  MARCA,
  preparar,
  renderizar,
  sha256,
  validarConfig,
  validarFase,
  validarPedido,
} from './aprovisionar';
import { type Contenedor, ErrorVerbo } from './verbos';

const DIA = new Date('2026-11-14T15:00:00Z'); // 12:00 Chile
const VENTANA = new Date('2026-11-14T05:00:00Z'); // 02:00 Chile
const A = `sha256:${'a'.repeat(64)}`;
const W = `sha256:${'b'.repeat(64)}`;
const CFG: Config = { erpInfra: '/srv/vinculos/erp/infra', registro: '127.0.0.1:5000', silosDir: '/silos', smtpUrl: 'smtp://mailpit:1025', sesConfigurationSet: '' };
const PEDIDO = { version: '0.1.0', dominio: 'kibou.vinculos.cl', nombre: "Centro Kibou (Ñuñoa)", tema: 'moderno' };
const IMAGENES = `# publicado\nVINCULOS_VERSION=0.1.0\nREGISTRO=127.0.0.1:5000\nAPI_DIGEST=${A}\nWEB_DIGEST=${W}\nVINCULOS_COMMIT=abc\n`;
const PLANTILLA = readFileSync(join(__dirname, '../../../infra/templates/silo.compose.tpl'), 'utf8');

const c = (servicio: string, proyecto = 'erp-kibou'): Contenedor => ({
  Id: 'a'.repeat(12),
  Labels: { 'com.docker.compose.project': proyecto, 'com.docker.compose.service': servicio },
  State: 'running',
  Status: 'Up',
});

function entorno(o: { contenedores?: Contenedor[]; enRegistro?: boolean; env?: string | null; token?: string | null; imagenes?: string | null; images?: string; wait?: string } = {}) {
  const archivos: Record<string, string | null> = { env: o.env ?? null, token: o.token ?? null, compose: null };
  const comandos: string[][] = [];
  const d: DockerApr = {
    listar: async (p) => (o.contenedores ?? []).filter((x) => x.Labels['com.docker.compose.project'] === p),
    existeEnRegistro: async () => o.enRegistro ?? true,
  };
  const disco: DiscoSilos = {
    plantilla: async () => PLANTILLA,
    leerImagenes: async (v) => (v === '0.1.0' ? (o.imagenes === undefined ? IMAGENES : o.imagenes) : null),
    leerEnv: async () => archivos.env,
    escribirEnv: async (_s, t) => void (archivos.env = t),
    escribirCompose: async (_s, t) => void (archivos.compose = t),
    existeCompose: async () => archivos.compose !== null,
    leerToken: async () => archivos.token,
    escribirToken: async (_s, t) => void (archivos.token = t),
  };
  const compose: Compose = {
    async correr(args) {
      comandos.push(args);
      const sub = args.slice(args.indexOf('--env-file') + 2);
      if (sub[0] === 'config' && sub[1] === '--images') return { codigo: 0, salida: o.images ?? `postgres:18-alpine\n127.0.0.1:5000/vinculos-api@${A}\n127.0.0.1:5000/vinculos-api@${A}\n127.0.0.1:5000/vinculos-web@${W}\n` };
      if (sub[0] === 'wait') return { codigo: 0, salida: o.wait ?? 'container "abc" exited with status code 0\n' };
      if (sub[0] === 'ps') return { codigo: 0, salida: 'db running\nmigrate exited\n' };
      return { codigo: 0, salida: '' };
    },
  };
  return { d, disco, compose, archivos, comandos };
}

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 0;
  } catch (e) {
    assert.ok(e instanceof ErrorVerbo, String(e));
    return e.status;
  }
};

describe('validaciones de entrada', () => {
  it('pedido: solo las cuatro claves y valores validos', () => {
    assert.deepEqual(validarPedido(PEDIDO), PEDIDO);
    for (const malo of [
      { ...PEDIDO, extra: 1 },
      { ...PEDIDO, version: 'latest' },
      { ...PEDIDO, dominio: 'KIBOU.cl' },
      { ...PEDIDO, dominio: 'kibou' },
      { ...PEDIDO, nombre: 'Centro "x"' },
      { ...PEDIDO, nombre: 'a$HOME' },
      { ...PEDIDO, nombre: 'linea\nOTRA=1' },
      { ...PEDIDO, tema: 'editorial' },
      null,
    ]) {
      assert.throws(() => validarPedido(malo), (e: unknown) => e instanceof ErrorVerbo && e.status === 400, JSON.stringify(malo));
    }
  });
  it('fase: bd o todo', () => {
    assert.equal(validarFase({ fase: 'bd' }), 'bd');
    assert.throws(() => validarFase({ fase: 'db' }));
    assert.throws(() => validarFase({ fase: 'todo', mas: 1 }));
  });
  it('config del host: rutas absolutas sin .. y registro valido', () => {
    assert.ok(validarConfig(CFG));
    assert.throws(() => validarConfig({ ...CFG, erpInfra: 'infra' }));
    assert.throws(() => validarConfig({ ...CFG, erpInfra: '/srv/../etc' }));
    assert.throws(() => validarConfig({ ...CFG, registro: 'http://x' }));
    assert.throws(() => validarConfig({ ...CFG, smtpUrl: 'smtp://a\nJWT_SECRET=x' }));
  });
  it('imagenes: version, registro y digests', () => {
    assert.equal(imagenesDe(IMAGENES, '0.1.0', '127.0.0.1:5000').api, `127.0.0.1:5000/vinculos-api@${A}`);
    assert.throws(() => imagenesDe(IMAGENES, '0.1.1', '127.0.0.1:5000'));
    assert.throws(() => imagenesDe(IMAGENES, '0.1.0', 'otro:5000'));
    assert.throws(() => imagenesDe(IMAGENES.replace(A, 'sha256:corto'), '0.1.0', '127.0.0.1:5000'));
  });
});

describe('renderizar', () => {
  it('rutas del ERP absolutas en el host; nada mas cambia', () => {
    const r = renderizar(PLANTILLA, CFG.erpInfra);
    assert.ok(r.includes('/srv/vinculos/erp/infra/postgres/init:/docker-entrypoint-initdb.d:ro'));
    assert.ok(r.includes('file: /srv/vinculos/erp/infra/secrets/${CLIENTE_SLUG}/kek'));
    assert.ok(r.includes('file: /srv/vinculos/erp/infra/secrets/${CLIENTE_SLUG}/recuperacion.pub'));
    const codigo = r.split('\n').filter((x) => !x.trim().startsWith('#')).join('\n');
    assert.ok(!codigo.includes('./postgres') && !codigo.includes('./secrets'));
    assert.equal(r.length - PLANTILLA.length, 3 * (CFG.erpInfra.length - 1));
  });
  it('una plantilla con build no se usa', () => {
    assert.throws(() => renderizar(`${PLANTILLA}\n    build:\n      context: .\n`, CFG.erpInfra));
  });
});

describe('preparar', () => {
  it('crea .env (secretos, token, digests) y compose; dos veces = mismos secretos', async () => {
    const e = entorno();
    const { log: log1, imagenes } = await preparar(e.d, e.disco, e.compose, CFG, 'kibou', PEDIDO);
    const v1 = leerVariables(e.archivos.env!);
    assert.ok(e.archivos.env!.startsWith(MARCA));
    assert.equal(v1.CLIENTE_SLUG, 'kibou');
    assert.equal(v1.CENTRO_NOMBRE, '"Centro Kibou (Ñuñoa)"');
    assert.equal(v1.API_DIGEST, A);
    assert.equal(v1.WEB_DIGEST, W);
    assert.equal(v1.REGISTRO, '127.0.0.1:5000');
    assert.match(v1.POSTGRES_PASSWORD, /^[0-9a-f]{48}$/);
    assert.match(v1.JWT_SECRET, /^[0-9a-f]{64}$/);
    assert.notEqual(v1.OWNER_DB_PASSWORD, v1.APP_DB_PASSWORD);
    assert.equal(v1.INTERNO_TOKEN_SHA256, sha256(e.archivos.token!));
    assert.equal(v1.CORREO_REMITENTE, 'no-responder@kibou.vinculos.cl');
    assert.ok(e.archivos.compose!.includes('/srv/vinculos/erp/infra/postgres/init'));
    assert.ok(log1.some((x) => x.includes('secretos nuevos')));
    assert.deepEqual(imagenes, { version: '0.1.0', apiDigest: A, webDigest: W });

    const token = e.archivos.token;
    const { log: log2 } = await preparar(e.d, e.disco, e.compose, CFG, 'kibou', { ...PEDIDO, tema: 'cuaderno' });
    const v2 = leerVariables(e.archivos.env!);
    for (const k of ['POSTGRES_PASSWORD', 'OWNER_DB_PASSWORD', 'APP_DB_PASSWORD', 'JWT_SECRET', 'INTERNO_TOKEN_SHA256']) assert.equal(v2[k], v1[k], k);
    assert.equal(e.archivos.token, token);
    assert.equal(v2.TEMA, 'cuaderno');
    assert.ok(log2.some((x) => x.includes('4 secretos conservados')));
  });
  it('compose corre con el proyecto y los archivos del silo', async () => {
    const e = entorno();
    await preparar(e.d, e.disco, e.compose, CFG, 'kibou', PEDIDO);
    assert.deepEqual(e.comandos[0].slice(0, 9), ['compose', '-p', 'erp-kibou', '--project-directory', '/silos/kibou', '-f', '/silos/kibou/docker-compose.yml', '--env-file', '/silos/kibou/.env']);
    assert.deepEqual(e.comandos.map((x) => x.slice(9).join(' ')), ['config --quiet', 'config --images']);
  });
  it('version no publicada: 404; digest que el registro no tiene: 409; registro de otro host: 409', async () => {
    assert.equal(await status(preparar(entorno().d, entorno().disco, entorno().compose, CFG, 'kibou', { ...PEDIDO, version: '0.2.0' })), 404);
    const sin = entorno({ enRegistro: false });
    assert.equal(await status(preparar(sin.d, sin.disco, sin.compose, CFG, 'kibou', PEDIDO)), 409);
    assert.equal(sin.archivos.env, null, 'sin imagen no escribe nada');
    const otro = entorno({ imagenes: IMAGENES.replace('REGISTRO=127.0.0.1:5000', 'REGISTRO=ghcr.io') });
    assert.equal(await status(preparar(otro.d, otro.disco, otro.compose, CFG, 'kibou', PEDIDO)), 409);
  });
  it('no toca un erp-<slug> ajeno (contenedores sin .env del ejecutor, o .env sin marca)', async () => {
    const ajeno = entorno({ contenedores: [c('db')] });
    assert.equal(await status(preparar(ajeno.d, ajeno.disco, ajeno.compose, CFG, 'kibou', PEDIDO)), 409);
    const aMano = entorno({ env: 'CLIENTE_SLUG=kibou\n' });
    assert.equal(await status(preparar(aMano.d, aMano.disco, aMano.compose, CFG, 'kibou', PEDIDO)), 409);
    assert.equal(aMano.archivos.env, 'CLIENTE_SLUG=kibou\n');
  });
  it('cambiar la version de un silo con contenedores es actualizar: 409', async () => {
    const e = entorno();
    await preparar(e.d, e.disco, e.compose, CFG, 'kibou', PEDIDO);
    const corriendo = entorno({ env: e.archivos.env!.replace('VINCULOS_VERSION=0.1.0', 'VINCULOS_VERSION=0.0.9'), contenedores: [c('db')] });
    assert.equal(await status(preparar(corriendo.d, corriendo.disco, corriendo.compose, CFG, 'kibou', PEDIDO)), 409);
  });
  it('una imagen fuera del registro o por tag en el compose: 500', async () => {
    const e = entorno({ images: `postgres:18-alpine\nvinculos-api:dev\n127.0.0.1:5000/vinculos-api@${A}\n127.0.0.1:5000/vinculos-web@${W}\n` });
    assert.equal(await status(preparar(e.d, e.disco, e.compose, CFG, 'kibou', PEDIDO)), 500);
  });
  it('slug invalido: 400', async () => {
    const e = entorno();
    assert.equal(await status(preparar(e.d, e.disco, e.compose, CFG, '../etc', PEDIDO)), 400);
  });
});

describe('levantar', () => {
  it('bd: up db migrate sin build y espera migrate; dos veces igual', async () => {
    const e = entorno();
    await preparar(e.d, e.disco, e.compose, CFG, 'kibou', PEDIDO);
    e.comandos.length = 0;
    for (let i = 0; i < 2; i++) {
      const log = await levantar(e.disco, e.compose, CFG, 'kibou', 'bd', DIA);
      assert.ok(log.includes('migrate termino en 0'));
    }
    const subs = e.comandos.map((x) => x.slice(9).join(' '));
    assert.equal(subs[0], 'up -d --no-build --pull missing --quiet-pull db migrate');
    assert.equal(subs[1], 'wait migrate');
    assert.equal(subs.filter((x) => x.startsWith('up')).length, 2);
  });
  it('todo: up de todo el silo', async () => {
    const e = entorno();
    await preparar(e.d, e.disco, e.compose, CFG, 'kibou', PEDIDO);
    e.comandos.length = 0;
    await levantar(e.disco, e.compose, CFG, 'kibou', 'todo', DIA);
    assert.equal(e.comandos[0].slice(9).join(' '), 'up -d --no-build --pull missing --quiet-pull');
  });
  it('sin preparar: 409; en la ventana de respaldo: 409', async () => {
    const e = entorno();
    assert.equal(await status(levantar(e.disco, e.compose, CFG, 'kibou', 'bd', DIA)), 409);
    await preparar(e.d, e.disco, e.compose, CFG, 'kibou', PEDIDO);
    assert.equal(await status(levantar(e.disco, e.compose, CFG, 'kibou', 'bd', VENTANA)), 409);
  });
  it('migrate con error: 500', async () => {
    const e = entorno();
    await preparar(e.d, e.disco, e.compose, CFG, 'kibou', PEDIDO);
    const falla: Compose = { correr: async (args) => (args.includes('wait') ? { codigo: 1, salida: '1\n' } : e.compose.correr(args, 0)) };
    assert.equal(await status(levantar(e.disco, falla, CFG, 'kibou', 'bd', DIA)), 500);
  });
  it('todo sin llaves (P5 pendiente): 409 ESPERANDO_LLAVES', async () => {
    const e = entorno();
    await preparar(e.d, e.disco, e.compose, CFG, 'kibou', PEDIDO);
    const sinKek: Compose = {
      correr: async (args) =>
        args.includes('up')
          ? { codigo: 1, salida: 'Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /srv/vinculos/erp/infra/secrets/kibou/kek' }
          : e.compose.correr(args, 0),
    };
    await assert.rejects(levantar(e.disco, sinKek, CFG, 'kibou', 'todo', DIA), (x: unknown) => x instanceof ErrorVerbo && x.status === 409 && x.message.includes('ESPERANDO_LLAVES'));
  });
  it('wait sin la linea de estado no cuenta como exito; codigo distinto de 0 tampoco', async () => {
    for (const salida of ['', 'container "abc" exited with status code 1\n']) {
      const e = entorno({ wait: salida });
      await preparar(e.d, e.disco, e.compose, CFG, 'kibou', PEDIDO);
      assert.equal(await status(levantar(e.disco, e.compose, CFG, 'kibou', 'bd', DIA)), 500, JSON.stringify(salida));
    }
  });
});
