import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type Compose, type Config, contenidoEnv, MARCA } from './aprovisionar';
import { cargarDemo, type DiscoDemo, esSlugDemo, resembrarDemo, slugsDemo, validarPedidoDemo } from './demo';
import { ErrorVerbo } from './verbos';

const cfg: Config = { erpInfra: '/srv/erp/infra', registro: '127.0.0.1:5000', silosDir: '/silos', smtpUrl: '', sesConfigurationSet: '' };
const envDemo = `${MARCA}\nCLIENTE_SLUG=demo1\nPOSTGRES_DB=app\nOWNER_DB_PASSWORD=${'a'.repeat(48)}\nES_DEMO=true\n`;
const pedido = { cuentasMadre: 2, profesionales: 3, pacientes: 10, nombre: 'Centro Demo' };

function disco(env: string | null, cuentas: string | null = null) {
  const escritos: string[] = [];
  const d: DiscoDemo = {
    leerEnv: async () => env,
    leerCuentas: async () => cuentas,
    escribirCuentas: async (_s, c) => {
      escritos.push(c);
    },
  };
  return { d, escritos };
}

function compose(salida: string, codigo = 0) {
  const llamadas: { args: string[]; env?: Record<string, string> }[] = [];
  const c: Compose = {
    correr: async (args, _t, env) => {
      llamadas.push({ args, env });
      return { codigo, salida };
    },
  };
  return { c, llamadas };
}

const resultado = (yaCargado: boolean) =>
  `algo\nDEMO_RESULTADO ${JSON.stringify({ yaCargado, cuentas: [{ email: 'direccion1@demo1.demo.vinculos.cl', rol: 'ADMIN' }, { email: 'profesional1@demo1.demo.vinculos.cl', rol: 'PROFESIONAL' }], conteos: { horas: 5, evoluciones: 2, pacientes: 10 } })}\n`;

describe('demos (R10) en el ejecutor', () => {
  it('preparar escribe ES_DEMO=true solo para un slug demo', () => {
    const args = ['demo1', { version: '0.1.0', dominio: 'demo1.ejemplo.cl', nombre: 'Demo', tema: 'moderno' }, { apiDigest: 'x', webDigest: 'y' }, cfg, {}, 'h'] as const;
    assert.match(contenidoEnv(...args, true), /^ES_DEMO=true$/m);
    assert.doesNotMatch(contenidoEnv(...args), /ES_DEMO/);
  });

  it('EJECUTOR_DEMOS acepta un prefijo con comodin (demo-*), nunca un * solo', () => {
    assert.deepEqual(slugsDemo('demo-*, demo-fija'), ['demo-*', 'demo-fija']);
    for (const malo of ['*', 'demo*', '-*', 'de*mo', 'demo-**']) assert.throws(() => slugsDemo(malo), undefined, malo);
    const l = slugsDemo('demo-*');
    assert.equal(esSlugDemo(l, 'demo-paris'), true);
    assert.equal(esSlugDemo(l, 'paris'), false);
    assert.equal(esSlugDemo(l, 'demo-'), false);
    assert.equal(esSlugDemo(l, 'demos-x'), false);
    assert.equal(esSlugDemo(['demo-kibou'], 'demo-kibou2'), false);
  });
  it('EJECUTOR_DEMOS y el pedido se validan', () => {
    assert.deepEqual(slugsDemo(' demo1, demo2 '), ['demo1', 'demo2']);
    assert.throws(() => slugsDemo('Demo!'));
    assert.deepEqual(validarPedidoDemo(pedido), pedido);
    assert.throws(() => validarPedidoDemo({ ...pedido, pacientes: 301 }), ErrorVerbo);
    assert.throws(() => validarPedidoDemo({ ...pedido, extra: 1 }), ErrorVerbo);
    assert.throws(() => validarPedidoDemo({ ...pedido, nombre: 'x"; rm' }), ErrorVerbo);
  });

  it('solo slugs de EJECUTOR_DEMOS, aprovisionados por el ejecutor y con ES_DEMO=true', async () => {
    const { c } = compose(resultado(false));
    await assert.rejects(cargarDemo(disco(envDemo).d, c, cfg, ['otro'], 'demo1', pedido), /EJECUTOR_DEMOS/);
    await assert.rejects(cargarDemo(disco('CLIENTE_SLUG=demo1\nES_DEMO=true\n').d, c, cfg, ['demo1'], 'demo1', pedido), /no lo aprovisiono el ejecutor/);
    await assert.rejects(cargarDemo(disco(envDemo.replace('ES_DEMO=true\n', '')).d, c, cfg, ['demo1'], 'demo1', pedido), /ES_DEMO/);
    await assert.rejects(resembrarDemo(disco(envDemo).d, c, cfg, [], 'demo1'), /EJECUTOR_DEMOS/);
  });

  it('cargar: la contrasena va por el entorno, queda solo en demo-cuentas.txt y al agente vuelven conteos', async () => {
    const { d, escritos } = disco(envDemo);
    const { c, llamadas } = compose(resultado(false));
    const r = await cargarDemo(d, c, cfg, ['demo1'], 'demo1', pedido);
    const { args, env } = llamadas[0]!;
    assert.ok(args.includes('backend') && args.includes('dist/demo/generador-demo.js'));
    const clave = env!.SEED_PASSWORD!;
    assert.equal(clave.length, 18);
    assert.ok(!args.join(' ').includes(clave) && !args.join(' ').includes('a'.repeat(48)), 'sin secretos en los argumentos');
    assert.match(env!.MIGRATION_DATABASE_URL!, /^postgresql:\/\/vinculos_owner:a{48}@db:5432\/app/);
    assert.equal(env!.DEMO_PACIENTES, '10');
    assert.match(escritos[0]!, new RegExp(`Contrasena de todas las cuentas: ${clave}`));
    assert.match(escritos[0]!, /ADMIN\tdireccion1@/);
    const texto = JSON.stringify(r);
    assert.ok(!texto.includes(clave) && !texto.includes('@'), 'ni contrasena ni correos al agente');
    assert.deepEqual(r.demo.porRol, { ADMIN: 1, PROFESIONAL: 1 });
  });

  it('cargar repetido: sin cambios si existe el archivo; sin el archivo no se conoce la contrasena (409)', async () => {
    const con = disco(envDemo, '# cuentas');
    const r = await cargarDemo(con.d, compose(resultado(true)).c, cfg, ['demo1'], 'demo1', pedido);
    assert.equal(r.demo.yaCargado, true);
    assert.equal(con.escritos.length, 0);
    await assert.rejects(cargarDemo(disco(envDemo).d, compose(resultado(true)).c, cfg, ['demo1'], 'demo1', pedido), /demo-cuentas\.txt/);
  });

  it('un generador fallido no filtra la contrasena en el error', async () => {
    const { c } = {
      c: {
        correr: async (_a: string[], _t: number, env?: Record<string, string>) => ({ codigo: 1, salida: `[GeneradorDemo] ERROR fallo con ${env!.SEED_PASSWORD}` }),
      } as Compose,
    };
    await assert.rejects(cargarDemo(disco(envDemo).d, c, cfg, ['demo1'], 'demo1', pedido), (e: Error) => /\*\*\*/.test(e.message) && !/[A-Za-z0-9]{18}$/.test(e.message));
  });

  it('resembrar: corre el script en migrate y devuelve su linea de conteos', async () => {
    const { c, llamadas } = compose('[Nest] 1 LOG [DemoResembrar] Demo demo1: 3 hora(s) agendada(s)\n');
    const r = await resembrarDemo(disco(envDemo).d, c, cfg, ['demo1'], 'demo1');
    assert.deepEqual(llamadas[0]!.args.slice(-3), ['migrate', 'node', 'prisma/scripts/demo_resembrar.js']);
    assert.deepEqual(r.log, ['Demo demo1: 3 hora(s) agendada(s)']);
  });
});
