import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

describe('ACTUALIZAR U6 (R6): notas de version', () => {
  it('entrega version y notas; sin notas no llama; si el silo no las acepta el job sigue OK con el motivo en el log', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tokens-'));
    process.env.TOKENS_INTERNOS_DIR = dir;
    await writeFile(join(dir, 'kibou.token'), 't'.repeat(40));
    const { EJECUTORES } = await import('./jobs');
    const job = (notas: string | null) => ({ id: 1, tipo: 'ACTUALIZAR', slug: 'kibou', revision: 1, hashManifiesto: 'x', manifiesto: null, referencia: '0.1.1', notas, pasos: [] });
    const antes = globalThis.fetch;
    const enviados: unknown[] = [];
    let status = 200;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      assert.match(url, /\/api\/internal\/notas-version$/);
      enviados.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(status === 200 ? { resultado: 'REGISTRADA' } : { message: 'Cannot POST' }), { status });
    }) as typeof fetch;
    try {
      assert.deepEqual(await EJECUTORES.U6(job(null)), { estado: 'OK', log: ['sin notas para esta version'] });
      assert.equal(enviados.length, 0);
      assert.equal((await EJECUTORES.U6(job('Agenda: nuevo filtro por box.'))).estado, 'OK');
      assert.deepEqual(enviados[0], { version: '0.1.1', notas: 'Agenda: nuevo filtro por box.' });
      status = 404;
      const r = await EJECUTORES.U6(job('x'));
      assert.equal(r.estado, 'OK');
      assert.match(r.log[0], /no tiene R6/);
    } finally {
      globalThis.fetch = antes;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
