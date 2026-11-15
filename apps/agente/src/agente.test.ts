import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, it, test } from 'node:test';

import { calcularStats, dominioDesdeLabels, lineasMultiplexadas } from './docker';
import { EJECUTORES, ejecutar, jsonCanonico, type JobReclamado } from './jobs';
import { latenciasDesdeLogs, normalizarRuta } from './p95';

test('normaliza rutas: sin query, uuid -> :id, numeros -> :n', () => {
  assert.equal(normalizarRuta('/api/citas/1b2c3d4e-0000-4000-8000-123456789abc?desde=2026'), '/api/citas/:id');
  assert.equal(normalizarRuta('/api/agenda/2026/11'), '/api/agenda/:n/:n');
});

test('p95 nearest-rank desde lineas de pino; ignora lo que no es request completed', () => {
  const linea = (url: string, ms: number) => JSON.stringify({ level: 30, req: { method: 'GET', url }, res: { statusCode: 200 }, responseTime: ms, msg: 'request completed' });
  const lineas = [...Array.from({ length: 19 }, (_, i) => linea('/api/salud', i + 1)), linea('/api/salud', 500), 'no json', '{"msg":"otra"}'];
  assert.deepEqual(latenciasDesdeLogs(lineas), [{ ruta: 'GET /api/salud', n: 20, p50: 10, p95: 19, max: 500 }]);
});

test('dominio desde la label del router -api de Traefik', () => {
  assert.equal(dominioDesdeLabels({ 'traefik.http.routers.estres-api.rule': 'Host(`estres.charlielearns.work`) && PathPrefix(`/api`)' }), 'estres.charlielearns.work');
  assert.equal(dominioDesdeLabels({ 'traefik.http.routers.estres-web.rule': 'Host(`x.cl`)' }), undefined);
});

test('logs multiplexados de Docker: quita las cabeceras de 8 bytes', () => {
  const conLargo = (s: string) => {
    const cabecera = Buffer.alloc(8);
    cabecera[0] = 1; // stdout
    cabecera.writeUInt32BE(Buffer.byteLength(s), 4);
    return Buffer.concat([cabecera, Buffer.from(s)]);
  };
  assert.deepEqual(lineasMultiplexadas(Buffer.concat([conLargo('uno\n'), conLargo('dos\n')])), ['uno', 'dos', '']);
});

test('stats como docker stats: CPU por delta y memoria sin cache', () => {
  const s = calcularStats({
    cpu_stats: { cpu_usage: { total_usage: 2_000 }, system_cpu_usage: 20_000, online_cpus: 4 },
    precpu_stats: { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 10_000 },
    memory_stats: { usage: 150, limit: 256, stats: { inactive_file: 50 } },
  });
  assert.deepEqual(s, { cpuPct: 40, memBytes: 100, memLimite: 256 });
});

// El paquete compartido compilado (pnpm manifest build): el agente no lo empaqueta, solo se compara contra el.
const { hashManifiesto } = createRequire(__filename)('../../../packages/manifest/dist/hash') as { hashManifiesto: (v: unknown) => string };

describe('jobs del agente', () => {
  const manifiesto = { schema: 1, centro: { id: 'kibou', nombre: 'Kibou' }, modulos: ['EQUIPO', 'MATCH'], reglas: {} };
  const job = (extra: Partial<JobReclamado> = {}): JobReclamado => ({
    id: 7,
    tipo: 'VERIFICAR',
    slug: 'kibou',
    revision: 3,
    hashManifiesto: hashManifiesto(manifiesto),
    manifiesto,
    pasos: [{ codigo: 'V1', estado: 'PENDIENTE' }],
    ...extra,
  });

  it('el hash canonico del agente es el mismo del paquete compartido', () => {
    assert.equal(createHash('sha256').update(jsonCanonico(manifiesto)).digest('hex'), hashManifiesto(manifiesto));
  });

  it('V1 detecta un manifiesto alterado', async () => {
    assert.equal((await EJECUTORES.V1(job())).estado, 'OK');
    assert.equal((await EJECUTORES.V1(job({ manifiesto: { ...manifiesto, modulos: ['FICHAS'] } }))).estado, 'FALLIDO');
  });

  it('lista cerrada: un paso desconocido se reporta FALLIDO sin ejecutar nada', async () => {
    const reportes: { ruta: string; cuerpo: { estado: string; error?: string } }[] = [];
    const enviar = async (ruta: string, cuerpo: unknown) => {
      reportes.push({ ruta, cuerpo: cuerpo as { estado: string } });
      return new Response(JSON.stringify({ seguir: true }), { status: 200 });
    };
    await ejecutar(job({ pasos: [{ codigo: 'rm -rf', estado: 'PENDIENTE' }] }), enviar, () => undefined);
    assert.equal(reportes.at(-1)?.cuerpo.estado, 'FALLIDO');
    assert.match(reportes.at(-1)?.cuerpo.error ?? '', /lista cerrada/);
  });

  it('se detiene si el plano de control responde 409 (cancelado)', async () => {
    let llamadas = 0;
    const enviar = async () => {
      llamadas++;
      return new Response('{}', { status: 409 });
    };
    await ejecutar(job({ pasos: [{ codigo: 'V1', estado: 'PENDIENTE' }, { codigo: 'V4', estado: 'PENDIENTE' }] }), enviar, () => undefined);
    assert.equal(llamadas, 1);
  });

  it('no repite pasos OK u OMITIDO (reintento desde el fallido)', async () => {
    const rutas: string[] = [];
    const enviar = async (ruta: string) => {
      rutas.push(ruta);
      return new Response(JSON.stringify({ seguir: true }), { status: 200 });
    };
    await ejecutar(job({ pasos: [{ codigo: 'V1', estado: 'OK' }, { codigo: 'V4', estado: 'PENDIENTE' }] }), enviar, () => undefined);
    assert.deepEqual([...new Set(rutas)], ['jobs/7/pasos/V4']);
  });
});

describe('APROVISIONAR en el agente', () => {
  const job = (manifiesto: unknown): JobReclamado => ({ id: 7, tipo: 'APROVISIONAR', slug: 'kibou', revision: 1, hashManifiesto: 'x', manifiesto, pasos: [] });
  const conFetch = async <T>(f: typeof fetch, cuerpo: () => Promise<T>): Promise<T> => {
    const antes = globalThis.fetch;
    globalThis.fetch = f;
    try {
      return await cuerpo();
    } finally {
      globalThis.fetch = antes;
    }
  };

  it('P8: dominio que responde /api/salud 200 = OK', async () => {
    const r = await conFetch(
      (async (url: string) => {
        assert.equal(url, 'https://kibou.vinculos.cl/api/salud');
        return new Response(JSON.stringify({ estado: 'ok', bd: true, canarios: true }), { status: 200 });
      }) as typeof fetch,
      () => EJECUTORES.P8(job({ dominio: { valor: 'kibou.vinculos.cl' } })),
    );
    assert.equal(r.estado, 'OK');
    assert.equal(r.espera, undefined);
  });

  it('P8: sin respuesta del dominio = espera al operador (nunca ACTIVO_SIN_DOMINIO)', async () => {
    const r = await conFetch(
      (async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
      }) as typeof fetch,
      () => EJECUTORES.P8(job({ dominio: { valor: 'kibou.vinculos.cl' } })),
    );
    assert.equal(r.estado, 'FALLIDO');
    assert.equal(r.espera, 'DOMINIO');
    assert.match(r.log[0], /ENOTFOUND/);
  });

  it('ejecutar manda espera y datos tal cual en el reporte final', async () => {
    const enviados: { ruta: string; cuerpo: unknown }[] = [];
    const enviar = async (ruta: string, cuerpo: unknown) => {
      enviados.push({ ruta, cuerpo });
      return new Response(JSON.stringify({ seguir: (cuerpo as { estado: string }).estado === 'EN_CURSO' }), { status: 200 });
    };
    const antes = EJECUTORES.P8;
    EJECUTORES.P8 = async () => ({ estado: 'FALLIDO', log: ['x'], error: 'sin dominio', espera: 'DOMINIO' });
    try {
      await ejecutar({ ...job({}), pasos: [{ codigo: 'P8', estado: 'PENDIENTE' }] }, enviar, () => undefined);
    } finally {
      EJECUTORES.P8 = antes;
    }
    assert.deepEqual(enviados.at(-1), { ruta: 'jobs/7/pasos/P8', cuerpo: { estado: 'FALLIDO', log: ['x'], error: 'sin dominio', espera: 'DOMINIO' } });
  });
});

describe('releases del host B', () => {
  it('lee un <version>.env de publicar.sh y descarta lo que no tiene la forma esperada', async () => {
    const { leerRelease } = await import('./releases');
    const ok = `# Publicado por publicar.sh\nVINCULOS_VERSION=0.1.0\nREGISTRO=127.0.0.1:5000\nAPI_DIGEST=sha256:${'a'.repeat(64)}\nWEB_DIGEST=sha256:${'b'.repeat(64)}\nVINCULOS_COMMIT=2ede6f13127ad0d59090649b5924494a79a50045\nVINCULOS_PUBLICADO=2026-11-15T15:39:00Z\n`;
    assert.deepEqual(leerRelease('0.1.0.env', ok), {
      version: '0.1.0',
      apiDigest: `sha256:${'a'.repeat(64)}`,
      webDigest: `sha256:${'b'.repeat(64)}`,
      commit: '2ede6f13127ad0d59090649b5924494a79a50045',
      publicada: '2026-11-15T15:39:00Z',
    });
    assert.equal(leerRelease('0.1.1.env', ok), null, 'el nombre no coincide con la version');
    assert.equal(leerRelease('0.1.0.env', ok.replace(/API_DIGEST=.*/, 'API_DIGEST=latest')), null);
    assert.equal(leerRelease('notas.env', ok), null);
  });
});

