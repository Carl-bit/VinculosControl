import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

describe('SOLO_LECTURA en el agente (R12)', () => {
  it('L1: ACTIVAR manda la fecha y comprueba; QUITAR la limpia; un ERP sin R12 (404) falla con la explicacion', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tokens-'));
    process.env.TOKENS_INTERNOS_DIR = dir;
    await writeFile(join(dir, 'kibou.token'), 't'.repeat(40));
    const { EJECUTORES } = await import('./jobs');
    const job = (referencia: string) => ({ id: 1, tipo: 'SOLO_LECTURA', slug: 'kibou', revision: 0, hashManifiesto: '', manifiesto: null, referencia, pasos: [] });
    const antes = globalThis.fetch;
    let estado = { soloLectura: false, fechaCorte: null as string | null };
    const enviados: unknown[] = [];
    let sinR12 = false;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (sinR12) return new Response(JSON.stringify({ message: 'Cannot POST /api/internal/salida' }), { status: 404 });
      if (init?.method === 'POST') {
        const b = JSON.parse(String(init.body)) as { soloLectura: boolean; fechaCorte?: string };
        enviados.push(b);
        estado = { soloLectura: b.soloLectura, fechaCorte: b.fechaCorte ?? null };
        return new Response(JSON.stringify({ resultado: 'APLICADA', ...estado }), { status: 200 });
      }
      assert.match(url, /\/api\/internal\/salida$/);
      return new Response(JSON.stringify(estado), { status: 200 });
    }) as typeof fetch;
    try {
      assert.equal((await EJECUTORES.L1(job('ACTIVAR:2026-12-31'))).estado, 'OK');
      assert.deepEqual(enviados[0], { soloLectura: true, fechaCorte: '2026-12-31' });
      assert.equal((await EJECUTORES.L1(job('QUITAR'))).estado, 'OK');
      assert.deepEqual(enviados[1], { soloLectura: false });
      assert.equal((await EJECUTORES.L1(job('OTRA'))).estado, 'FALLIDO');
      sinR12 = true;
      const r = await EJECUTORES.L1(job('ACTIVAR:2026-12-31'));
      assert.equal(r.estado, 'FALLIDO');
      assert.match(r.error ?? '', /no tiene R12/);
    } finally {
      globalThis.fetch = antes;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
