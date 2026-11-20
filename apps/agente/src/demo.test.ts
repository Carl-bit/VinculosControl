import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// jobs.ts lee EJECUTOR_URL al cargarse: se define antes de importarlo (este archivo corre en su propio proceso).
process.env.EJECUTOR_URL = 'http://ejecutor:7070';
process.env.EJECUTOR_TOKEN = 'x'.repeat(32);

describe('demos (R10) en el agente', () => {
  it('P10 de un demo pide cargar_demo con las cantidades del manifiesto (sin invitar al ADMIN); R1 pide resembrar_demo', async () => {
    const { EJECUTORES } = await import('./jobs');
    const llamadas: { url: string; cuerpo: unknown }[] = [];
    const antes = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      llamadas.push({ url, cuerpo: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ log: ['datos de demo generados', 'cuentas: 2 ADMIN, 5 PROFESIONAL'], acceso: { clave: 'abc', cuentas: [{ rol: 'ADMIN', email: 'direccion1@demo-kibou.demo.vinculos.cl' }] } }), { status: 200 });
    }) as typeof fetch;
    try {
      const manifiesto = { centro: { nombre: 'Centro Kibou Demo', admin: { nombre: 'X', correo: 'x@y.cl' } }, demo: { cuentas_madre: 2, profesionales: 5, pacientes: 60 } };
      const job = { id: 1, tipo: 'APROVISIONAR', slug: 'demo-kibou', revision: 1, hashManifiesto: 'x', manifiesto, referencia: null, pasos: [] };
      const r = await EJECUTORES.P10(job);
      assert.equal(r.estado, 'OK');
      assert.deepEqual(r.acceso, { clave: 'abc', cuentas: [{ rol: 'ADMIN', email: 'direccion1@demo-kibou.demo.vinculos.cl' }] }, 'el acceso del demo va en el reporte de P10');
      assert.equal(llamadas[0]!.url, 'http://ejecutor:7070/v1/silos/demo-kibou/cargar_demo');
      assert.deepEqual(llamadas[0]!.cuerpo, { cuentasMadre: 2, profesionales: 5, pacientes: 60, nombre: 'Centro Kibou Demo' });
      assert.equal(llamadas.length, 1, 'no se invita al ADMIN inicial');
      await EJECUTORES.R1({ ...job, tipo: 'REINICIAR_DEMO' });
      assert.equal(llamadas[1]!.url, 'http://ejecutor:7070/v1/silos/demo-kibou/resembrar_demo');
    } finally {
      globalThis.fetch = antes;
    }
  });
  it('P9 de un demo se omite (sin respaldo ni cron)', async () => {
    const { EJECUTORES } = await import('./jobs');
    const job = { id: 1, tipo: 'APROVISIONAR', slug: 'demo-kibou', revision: 1, hashManifiesto: 'x', manifiesto: { demo: { cuentas_madre: 1, profesionales: 1, pacientes: 0 } }, referencia: null, pasos: [] };
    const r = await EJECUTORES.P9(job);
    assert.equal(r.estado, 'OMITIDO');
  });
  it('P5 de un demo pide llaves_demo al ejecutor; un centro real no corre P5 en el agente', async () => {
    const { EJECUTORES } = await import('./jobs');
    const llamadas: string[] = [];
    const antes = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      llamadas.push(url);
      return new Response(JSON.stringify({ log: ['llaves de prueba generadas', 'partes de recuperacion borradas'] }), { status: 200 });
    }) as typeof fetch;
    try {
      const base = { id: 1, tipo: 'APROVISIONAR', slug: 'demo-kibou', revision: 1, hashManifiesto: 'x', referencia: null, pasos: [] };
      const r = await EJECUTORES.P5({ ...base, manifiesto: { demo: { cuentas_madre: 1, profesionales: 1, pacientes: 0 } } });
      assert.equal(r.estado, 'OK');
      assert.deepEqual(llamadas, ['http://ejecutor:7070/v1/silos/demo-kibou/llaves_demo']);
      const real = await EJECUTORES.P5({ ...base, slug: 'kibou', manifiesto: {} });
      assert.equal(real.estado, 'FALLIDO');
      assert.equal(llamadas.length, 1, 'un centro real no llama al ejecutor');
    } finally {
      globalThis.fetch = antes;
    }
  });
  it('reconectarBordes pide al ejecutor POST /v1/bordes/reconectar (agente recreado fuera del borde)', async () => {
    const { reconectarBordes } = await import('./jobs');
    const llamadas: { url: string; metodo?: string }[] = [];
    const antes = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      llamadas.push({ url, metodo: init?.method });
      return new Response(JSON.stringify({ log: ['vinculos-agente-agente-1 unido a erp-demo-2_borde'] }), { status: 200 });
    }) as typeof fetch;
    try {
      assert.deepEqual(await reconectarBordes(), ['vinculos-agente-agente-1 unido a erp-demo-2_borde']);
      assert.deepEqual(llamadas, [{ url: 'http://ejecutor:7070/v1/bordes/reconectar', metodo: 'POST' }]);
    } finally {
      globalThis.fetch = antes;
    }
  });
});
