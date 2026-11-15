import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { siloDe } from './docker';
import { silosConToken, sincronizarSilo, urlSilo } from './solicitudes';

test('siloDe: label cl.vinculos.silo coherente con el proyecto; sin label, por proyecto', () => {
  assert.equal(siloDe({ 'com.docker.compose.project': 'erp-kibou', 'cl.vinculos.silo': 'kibou' }), 'kibou');
  assert.equal(siloDe({ 'com.docker.compose.project': 'erp-kibou' }), 'kibou');
  assert.equal(siloDe({ 'com.docker.compose.project': 'erp-kibou', 'cl.vinculos.silo': 'otro' }), null);
  assert.equal(siloDe({ 'com.docker.compose.project': 'vinculos-agente' }), null);
});

test('silosConToken: solo <slug>.token validos y de 32+ caracteres', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tokens-'));
  try {
    await writeFile(join(dir, 'kibou.token'), `${'a'.repeat(64)}\n`);
    await writeFile(join(dir, 'corto.token'), 'abc');
    await writeFile(join(dir, '..raro.token'), 'b'.repeat(64));
    await writeFile(join(dir, 'notas.txt'), 'x');
    assert.deepEqual(await silosConToken(dir), [{ slug: 'kibou', token: 'a'.repeat(64) }]);
    assert.deepEqual(await silosConToken(''), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

test('sincronizarSilo: R2 -> plano de control -> R3; un R3 fallido viaja en el siguiente ciclo', async () => {
  const llamadas: string[] = [];
  const solicitud = { id: '11111111-1111-4111-8111-111111111111', modulo: 'MATCH', accion: 'ACTIVAR', pedidaPorRol: 'ADMIN', pedidaEn: '2026-11-13T12:00:00Z', estado: 'PENDIENTE', respondidaEn: null, actualizadaEn: '2026-11-13T12:00:00Z' };
  let r3Ok = false;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    llamadas.push(`${init?.method ?? 'GET'} ${url.replace(urlSilo('kibou'), '')}`);
    assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${'t'.repeat(40)}`);
    if (url.includes('/respuesta')) return new Response(JSON.stringify(r3Ok ? { estado: 'APROBADA' } : { mensaje: 'Esa respuesta no corresponde al estado actual de la solicitud' }), { status: r3Ok ? 201 : 422 });
    return new Response(JSON.stringify({ solicitudes: [solicitud] }), { status: 200 });
  }) as typeof fetch;
  const enviados: unknown[] = [];
  const post = async (_ruta: string, cuerpo: unknown) => {
    enviados.push(cuerpo);
    return new Response(JSON.stringify({ respuestas: [{ id: solicitud.id, estado: 'APROBADA', respuesta: 'ok' }] }), { status: 200 });
  };
  await sincronizarSilo('kibou', 't'.repeat(40), post, () => undefined);
  const primero = enviados[0] as { solicitudes: Record<string, unknown>[]; fallidas: unknown[] };
  // Solo los campos que acepta el plano de control (el DTO rechaza cualquier otro).
  assert.deepEqual(Object.keys(primero.solicitudes[0]).sort(), ['accion', 'estado', 'id', 'modulo', 'pedidaEn', 'pedidaPorRol']);
  assert.deepEqual(primero.fallidas, []);
  r3Ok = true;
  assert.equal(await sincronizarSilo('kibou', 't'.repeat(40), post, () => undefined), 1);
  const segundo = enviados[1] as { fallidas: { id: string; error: string }[] };
  assert.equal(segundo.fallidas[0].id, solicitud.id);
  assert.match(segundo.fallidas[0].error, /^HTTP 422 Esa respuesta no corresponde/);
  // El segundo GET pide solo lo actualizado despues de lo ya visto.
  assert.ok(llamadas.some((l) => l.startsWith('GET /solicitudes?desde=')));
});

test('SILO_INTERNO_URL (atajo de desarrollo) solo para los slugs de SILO_INTERNO_SLUGS; el resto por su red de borde', async () => {
  // La configuracion se lee al cargar el modulo: se prueba en un proceso aparte.
  const { execFileSync } = await import('node:child_process');
  const ver = (env: Record<string, string>) =>
    execFileSync(process.execPath, ['--import', 'tsx', '-e', "import('./src/solicitudes.ts').then((m) => console.log(m.urlSilo('centro-prueba') + ' ' + m.urlSilo('e2eprov')))"], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
    }).trim();
  const atajo = 'http://host.docker.internal:3001/api/internal';
  assert.equal(ver({ SILO_INTERNO_URL: atajo, SILO_INTERNO_SLUGS: 'centro-prueba' }), `${atajo} http://erp-e2eprov-backend-1:3001/api/internal`);
  // Sin lista, el atajo no aplica a nadie (antes era global y rompio P6 de un silo aprovisionado).
  assert.equal(ver({ SILO_INTERNO_URL: atajo, SILO_INTERNO_SLUGS: '' }), 'http://erp-centro-prueba-backend-1:3001/api/internal http://erp-e2eprov-backend-1:3001/api/internal');
});
