import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { exporteEnCurso } from './exportaciones';

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

const responder = (status: number, cuerpo: unknown) => {
  globalThis.fetch = (async () => new Response(JSON.stringify(cuerpo), { status })) as typeof fetch;
};
const exp = (estado: string) => ({ id: '11111111-1111-4111-8111-111111111111', estado, creadaEn: '2026-11-16T12:00:00Z', terminadaEn: null, venceEn: null, bytes: null, huella: null });

test('exporteEnCurso: PENDIENTE o EN_PROCESO bloquean; LISTA no; 404 = ERP sin R13; otro error se propaga', async () => {
  responder(200, { exportaciones: [exp('LISTA'), exp('EN_PROCESO')] });
  assert.equal((await exporteEnCurso('kibou', 't'.repeat(40))).enCurso?.estado, 'EN_PROCESO');
  responder(200, { exportaciones: [exp('LISTA'), exp('DESCARGADA')] });
  assert.deepEqual(await exporteEnCurso('kibou', 't'.repeat(40)), { enCurso: null, sinR13: false });
  responder(404, { message: 'Cannot GET /api/internal/exportaciones' });
  assert.deepEqual(await exporteEnCurso('kibou', 't'.repeat(40)), { enCurso: null, sinR13: true });
  responder(401, { mensaje: 'Token interno invalido' });
  await assert.rejects(exporteEnCurso('kibou', 't'.repeat(40)), /HTTP 401/);
});
