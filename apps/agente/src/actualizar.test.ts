import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// jobs.ts lee EJECUTOR_URL al cargarse: se define antes de importarlo (este archivo corre en su propio proceso).
process.env.EJECUTOR_URL = 'http://ejecutor:7070';
process.env.EJECUTOR_TOKEN = 'x'.repeat(32);

describe('ACTUALIZAR en el agente: vuelta atras', () => {
  it('si U4 falla, revierte, comprueba la salud y reporta FALLIDO con la version a la que volvio', async () => {
    const { EJECUTORES } = await import('./jobs');
    const llamadas: string[] = [];
    const antes = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      llamadas.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/levantar')) return new Response(JSON.stringify({ error: 'docker compose up (todo): fallo' }), { status: 500 });
      if (url.endsWith('/revertir')) return new Response(JSON.stringify({ log: ['.env de vuelta en 0.1.0'], imagenes: { version: '0.1.0' } }), { status: 200 });
      return new Response(JSON.stringify({ estado: 'ok', bd: true, canarios: true }), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await EJECUTORES.U4({ id: 1, tipo: 'ACTUALIZAR', slug: 'kibou', revision: 1, hashManifiesto: 'x', manifiesto: null, referencia: '0.1.1', pasos: [] });
      assert.equal(r.estado, 'FALLIDO');
      assert.match(r.error ?? '', /Vuelto a 0\.1\.0 \(silo sano\)/);
      assert.ok(llamadas.some((l) => l.startsWith('POST') && l.endsWith('/revertir')));
    } finally {
      globalThis.fetch = antes;
    }
  });

  it('si la vuelta atras tambien falla, el error pide revisar el silo a mano', async () => {
    const { EJECUTORES } = await import('./jobs');
    const antes = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'no' }), { status: 500 })) as typeof fetch;
    try {
      const r = await EJECUTORES.U3({ id: 1, tipo: 'ACTUALIZAR', slug: 'kibou', revision: 1, hashManifiesto: 'x', manifiesto: null, referencia: '0.1.1', pasos: [] });
      assert.equal(r.estado, 'FALLIDO');
      assert.match(r.error ?? '', /vuelta atras tambien fallo/);
    } finally {
      globalThis.fetch = antes;
    }
  });
});
