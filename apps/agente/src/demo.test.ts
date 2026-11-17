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
      return new Response(JSON.stringify({ log: ['datos de demo generados', 'cuentas: 2 ADMIN, 5 PROFESIONAL'] }), { status: 200 });
    }) as typeof fetch;
    try {
      const manifiesto = { centro: { nombre: 'Centro Kibou Demo', admin: { nombre: 'X', correo: 'x@y.cl' } }, demo: { cuentas_madre: 2, profesionales: 5, pacientes: 60 } };
      const job = { id: 1, tipo: 'APROVISIONAR', slug: 'demo-kibou', revision: 1, hashManifiesto: 'x', manifiesto, referencia: null, pasos: [] };
      const r = await EJECUTORES.P10(job);
      assert.equal(r.estado, 'OK');
      assert.equal(llamadas[0]!.url, 'http://ejecutor:7070/v1/silos/demo-kibou/cargar_demo');
      assert.deepEqual(llamadas[0]!.cuerpo, { cuentasMadre: 2, profesionales: 5, pacientes: 60, nombre: 'Centro Kibou Demo' });
      assert.equal(llamadas.length, 1, 'no se invita al ADMIN inicial');
      await EJECUTORES.R1({ ...job, tipo: 'REINICIAR_DEMO' });
      assert.equal(llamadas[1]!.url, 'http://ejecutor:7070/v1/silos/demo-kibou/resembrar_demo');
    } finally {
      globalThis.fetch = antes;
    }
  });
});
