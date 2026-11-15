import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { actualizar, type DiscoActualizar, nombreRespaldo, reemplazarLineas, respaldar, revertir, type Tuberia, validarVersion } from './actualizar';
import { argsCompose, type Compose, type Config, type DockerApr, leerVariables, MARCA } from './aprovisionar';
import { type Contenedor, ErrorVerbo } from './verbos';

const DIA = new Date('2026-11-14T15:00:00Z');
const VENTANA = new Date('2026-11-14T05:00:00Z');
const A1 = `sha256:${'1'.repeat(64)}`;
const W1 = `sha256:${'2'.repeat(64)}`;
const A2 = `sha256:${'3'.repeat(64)}`;
const W2 = `sha256:${'4'.repeat(64)}`;
const CFG: Config = { erpInfra: '/srv/erp/infra', registro: '127.0.0.1:5000', silosDir: '/silos', smtpUrl: '', sesConfigurationSet: '' };
const ENV = `${MARCA}\nCLIENTE_SLUG=kibou\nVINCULOS_VERSION=0.1.0\nREGISTRO=127.0.0.1:5000\nAPI_DIGEST=${A1}\nWEB_DIGEST=${W1}\nPOSTGRES_PASSWORD=${'a'.repeat(48)}\nJWT_SECRET=${'b'.repeat(64)}\n`;
const IMG = (v: string, a: string, w: string) => `VINCULOS_VERSION=${v}\nREGISTRO=127.0.0.1:5000\nAPI_DIGEST=${a}\nWEB_DIGEST=${w}\n`;
const db: Contenedor = { Id: 'a'.repeat(12), Labels: { 'com.docker.compose.project': 'erp-kibou', 'com.docker.compose.service': 'db' }, State: 'running', Status: 'Up' };

function entorno(o: { env?: string | null; contenedores?: Contenedor[] } = {}) {
  const f: Record<string, string | null> = { env: o.env === undefined ? ENV : o.env, anterior: null };
  const comandos: string[][] = [];
  const d: DockerApr = { listar: async () => o.contenedores ?? [db], existeEnRegistro: async () => true };
  const disco: DiscoActualizar = {
    plantilla: async () => '',
    leerImagenes: async (v) => ({ '0.1.0': IMG('0.1.0', A1, W1), '0.1.1': IMG('0.1.1', A2, W2) })[v] ?? null,
    leerEnv: async () => f.env,
    escribirEnv: async (_s, t) => void (f.env = t),
    escribirCompose: async () => undefined,
    existeCompose: async () => true,
    leerToken: async () => null,
    escribirToken: async () => undefined,
    leerAnterior: async () => f.anterior,
    escribirAnterior: async (_s, t) => void (f.anterior = t),
  };
  const c: Compose = {
    async correr(args) {
      comandos.push(args);
      if (args.includes('--images')) {
        const v = leerVariables(f.env ?? '');
        return { codigo: 0, salida: `postgres:18-alpine\n127.0.0.1:5000/vinculos-api@${v.API_DIGEST}\n127.0.0.1:5000/vinculos-web@${v.WEB_DIGEST}\n` };
      }
      return { codigo: 0, salida: '' };
    },
  };
  return { d, disco, c, f, comandos };
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

describe('actualizar', () => {
  it('cambia solo las 4 lineas de imagen, guarda anterior.env y conserva los secretos; dos veces = igual', async () => {
    const e = entorno();
    const r1 = await actualizar(e.d, e.disco, e.c, CFG, 'kibou', '0.1.1', DIA);
    const v = leerVariables(e.f.env!);
    assert.deepEqual([v.VINCULOS_VERSION, v.API_DIGEST, v.WEB_DIGEST], ['0.1.1', A2, W2]);
    assert.equal(v.POSTGRES_PASSWORD, 'a'.repeat(48));
    assert.equal(v.JWT_SECRET, 'b'.repeat(64));
    assert.equal(leerVariables(e.f.anterior!).API_DIGEST, A1);
    assert.equal(r1.anterior, '0.1.0');
    assert.deepEqual(r1.imagenes, { version: '0.1.1', apiDigest: A2, webDigest: W2 });

    // Reintento: no pisa anterior.env con la version nueva (perderia la vuelta atras).
    const r2 = await actualizar(e.d, e.disco, e.c, CFG, 'kibou', '0.1.1', DIA);
    assert.equal(leerVariables(e.f.anterior!).VINCULOS_VERSION, '0.1.0');
    assert.equal(r2.anterior, null);
    assert.ok(r2.log.some((l) => l.includes('ya en 0.1.1')));
  });
  it('rechaza: version sin publicar 404, silo sin contenedores 409, .env ajeno 409, ventana 409', async () => {
    const e = entorno();
    assert.equal(await status(actualizar(e.d, e.disco, e.c, CFG, 'kibou', '0.2.0', DIA)), 404);
    const vacio = entorno({ contenedores: [] });
    assert.equal(await status(actualizar(vacio.d, vacio.disco, vacio.c, CFG, 'kibou', '0.1.1', DIA)), 409);
    const ajeno = entorno({ env: 'CLIENTE_SLUG=kibou\n' });
    assert.equal(await status(actualizar(ajeno.d, ajeno.disco, ajeno.c, CFG, 'kibou', '0.1.1', DIA)), 409);
    assert.equal(await status(actualizar(e.d, e.disco, e.c, CFG, 'kibou', '0.1.1', VENTANA)), 409);
    assert.equal(e.f.anterior, null, 'nada cambio');
  });
  it('version del cuerpo', () => {
    assert.equal(validarVersion({ version: '0.1.1' }), '0.1.1');
    assert.throws(() => validarVersion({ version: 'latest' }));
    assert.throws(() => validarVersion({ version: '0.1.1', mas: 1 }));
  });
});

describe('revertir', () => {
  it('vuelve a anterior.env y recrea solo backend y frontend, sin migrate; dos veces = igual', async () => {
    const e = entorno();
    await actualizar(e.d, e.disco, e.c, CFG, 'kibou', '0.1.1', DIA);
    e.comandos.length = 0;
    for (let i = 0; i < 2; i++) {
      const r = await revertir(e.disco, e.c, CFG, 'kibou', argsCompose);
      assert.equal(r.imagenes.version, '0.1.0');
    }
    assert.equal(leerVariables(e.f.env!).API_DIGEST, A1);
    assert.equal(e.comandos[0].slice(9).join(' '), 'up -d --no-build --no-deps --pull missing --quiet-pull backend frontend');
    assert.ok(!e.comandos.flat().includes('migrate'));
  });
  it('sin anterior.env: 409', async () => {
    const e = entorno();
    assert.equal(await status(revertir(e.disco, e.c, CFG, 'kibou', argsCompose)), 409);
  });
});

describe('respaldar', () => {
  const t = (r: Awaited<ReturnType<Tuberia['respaldar']>>): Tuberia => ({ respaldar: async () => r });
  it('nombre como respaldar.sh y resultado con sha256', async () => {
    assert.equal(nombreRespaldo('kibou', new Date('2026-11-15T17:05:51.123Z')), 'kibou-20261115T170551Z.dump.enc');
    const r = await respaldar(entorno().disco, t({ bytes: 4096, sha256: 'c'.repeat(64) }), 'kibou', DIA);
    assert.equal(r.respaldo.bytes, 4096);
  });
  it('sin respaldo.key: 409; pg_dump fallido o respaldo de 32 bytes (R14): 500', async () => {
    const e = entorno();
    const sinLlave = t({ error: 'pg_dump 0, openssl 125. invalid mount config for type "bind": bind source path does not exist: /srv/erp/infra/secrets/kibou/respaldo.key' });
    assert.equal(await status(respaldar(e.disco, sinLlave, 'kibou', DIA)), 409);
    assert.equal(await status(respaldar(e.disco, t({ error: 'pg_dump 1, openssl 0' }), 'kibou', DIA)), 500);
    assert.equal(await status(respaldar(e.disco, t({ bytes: 32, sha256: 'c'.repeat(64) }), 'kibou', DIA)), 500);
    assert.equal(await status(respaldar(e.disco, t({ bytes: 4096, sha256: 'c'.repeat(64) }), 'kibou', VENTANA)), 409);
  });
});

it('reemplazarLineas: cambia las que estan y agrega las que faltan, sin tocar el resto', () => {
  assert.equal(reemplazarLineas('A=1\nVINCULOS_VERSION=0.1.0\nB=2\n', { VINCULOS_VERSION: '0.1.1', REGISTRO: 'r:5000' }), 'A=1\nVINCULOS_VERSION=0.1.1\nB=2\nREGISTRO=r:5000\n');
});
