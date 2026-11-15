import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { conPrevia, detener, type Disco, type DockerCiclo, eliminacionPrevia, eliminar, reanudar, type RedProyecto, type Volumen } from './ciclo';
import { type Contenedor, ErrorVerbo } from './verbos';

const DIA = new Date('2026-11-14T15:00:00Z'); // 12:00 Chile: fuera de la ventana
const VENTANA = new Date('2026-11-14T05:00:00Z'); // 02:00 Chile
const ACTA = 'ab'.repeat(32);

const c = (servicio: string, estado = 'running', proyecto = 'erp-kibou'): Contenedor => ({
  Id: `${servicio}`.padEnd(12, '0').replace(/[^0-9a-f]/g, 'a'),
  Labels: { 'com.docker.compose.project': proyecto, 'com.docker.compose.service': servicio },
  State: estado,
  Status: estado,
});
const vol = (nombre: string, proyecto = 'erp-kibou'): Volumen => ({ Name: nombre, Labels: { 'com.docker.compose.project': proyecto } });
const red = (nombre: string, proyecto = 'erp-kibou'): RedProyecto => ({ Id: nombre.length.toString(16).padStart(12, 'c'), Name: nombre, Labels: { 'com.docker.compose.project': proyecto } });

function falso(cs: Contenedor[], opts: { vols?: Volumen[]; redes?: RedProyecto[]; salud?: (string | null)[] } = {}) {
  const hechos: string[] = [];
  const salud = [...(opts.salud ?? ['healthy'])];
  const d: DockerCiclo = {
    async listar(p) {
      return cs.filter((x) => x.Labels['com.docker.compose.project'] === p);
    },
    async salud() {
      return salud.length > 1 ? salud.shift()! : salud[0];
    },
    async detener(id) {
      hechos.push(`stop ${cs.find((x) => x.Id === id)?.Labels['com.docker.compose.service']}`);
    },
    async arrancar(id) {
      hechos.push(`start ${cs.find((x) => x.Id === id)?.Labels['com.docker.compose.service']}`);
    },
    async borrarContenedor(id) {
      hechos.push(`rm ${cs.find((x) => x.Id === id)?.Labels['com.docker.compose.service']}`);
    },
    async volumenes() {
      return opts.vols ?? [];
    },
    async borrarVolumen(n) {
      hechos.push(`rmvol ${n}`);
    },
    async redes() {
      return opts.redes ?? [];
    },
    async borrarRed(id) {
      hechos.push(`rmred ${(opts.redes ?? []).find((r) => r.Id === id)?.Name}`);
    },
  };
  return { d, hechos };
}

function disco(consentimiento: string | null, respaldos: { archivo: string; bytes: number }[] | null = [{ archivo: 'a.dump.enc', bytes: 100 }]) {
  const hechos: string[] = [];
  const x: Disco = {
    async leerConsentimiento() {
      return consentimiento;
    },
    async respaldos() {
      return respaldos;
    },
    async borrarRespaldos(slug) {
      hechos.push(`rm respaldos/${slug}`);
    },
  };
  return { x, hechos };
}

const status = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErrorVerbo) return e.status;
    throw e;
  }
  return 200;
};

describe('detener (B)', () => {
  it('para frontend, backend y db en ese orden; lo detenido no se toca', async () => {
    const { d, hechos } = falso([c('db'), c('migrate', 'exited'), c('backend'), c('frontend')]);
    const log = await detener(d, 'kibou', DIA);
    assert.deepEqual(hechos, ['stop frontend', 'stop backend', 'stop db']);
    assert.ok(log.some((l) => l.includes('migrate ya estaba detenido')));
  });
  it('idempotente: todo detenido no hace nada', async () => {
    const { d, hechos } = falso([c('db', 'exited'), c('backend', 'exited')]);
    await detener(d, 'kibou', DIA);
    assert.deepEqual(hechos, []);
  });
  it('solo su proyecto, nunca otro silo; ventana de respaldo y slug invalido', async () => {
    const { d, hechos } = falso([c('db', 'running', 'erp-otro'), c('db')]);
    await detener(d, 'kibou', DIA);
    assert.deepEqual(hechos, ['stop db']);
    assert.equal(await status(detener(d, 'kibou', VENTANA)), 409);
    assert.equal(await status(detener(d, '../etc', DIA)), 400);
    assert.equal(await status(detener(falso([]).d, 'kibou', DIA)), 404);
  });
});

describe('reanudar (B)', () => {
  it('db primero, espera sana, despues backend y frontend; migrate no se arranca', async () => {
    const { d, hechos } = falso([c('frontend', 'exited'), c('migrate', 'exited'), c('backend', 'exited'), c('db', 'exited')], { salud: ['starting', 'healthy'] });
    await reanudar(d, 'kibou', DIA, 10, 1);
    assert.deepEqual(hechos, ['start db', 'start backend', 'start frontend']);
  });
  it('si db no queda sana, no arranca backend ni frontend', async () => {
    const { d, hechos } = falso([c('db', 'exited'), c('backend', 'exited')], { salud: ['unhealthy'] });
    assert.equal(await status(reanudar(d, 'kibou', DIA, 3, 1)), 504);
    assert.deepEqual(hechos, ['start db']);
  });
  it('sin db no hay silo que reanudar', async () => {
    assert.equal(await status(reanudar(falso([c('backend', 'exited')]).d, 'kibou', DIA)), 404);
  });
});

describe('eliminar (C)', () => {
  const detenido = () => [c('db', 'exited'), c('backend', 'exited'), c('frontend', 'exited'), c('migrate', 'exited')];
  const vols = [vol('erp-kibou_db_data'), vol('erp-kibou_exportaciones'), vol('erp-otro_db_data', 'erp-otro'), vol('ajeno_db', 'erp-kibou')];
  const redes = [red('erp-kibou_interna'), red('erp-kibou_silo'), red('erp-kibou_borde'), red('proxy', 'erp-kibou')];

  it('sin consentimiento local o con otro hash: 403 y no borra nada', async () => {
    const { d, hechos } = falso(detenido(), { vols, redes });
    assert.equal(await status(eliminar(d, disco(null).x, 'kibou', ACTA, DIA)), 403);
    assert.equal(await status(eliminar(d, disco('cd'.repeat(32)).x, 'kibou', ACTA, DIA)), 403);
    assert.deepEqual(hechos, []);
  });

  it('rechazado (403, 409, 400) no suelta el borde; aceptado lo suelta antes de borrar', async () => {
    let soltados = 0;
    const soltar = async () => {
      soltados++;
      return ['traefik separado'];
    };
    const enMarcha = falso([c('db'), c('backend'), c('frontend')], { vols, redes });
    assert.equal(await status(eliminar(enMarcha.d, disco(null).x, 'kibou', ACTA, DIA, soltar)), 403);
    assert.equal(await status(eliminar(enMarcha.d, disco('cd'.repeat(32)).x, 'kibou', ACTA, DIA, soltar)), 403);
    assert.equal(await status(eliminar(enMarcha.d, disco(ACTA).x, 'kibou', ACTA, DIA, soltar)), 409);
    assert.equal(await status(eliminar(enMarcha.d, disco(ACTA).x, 'kibou', 'xyz', DIA, soltar)), 400);
    assert.equal(soltados, 0);
    const r = await eliminar(falso(detenido(), { vols, redes }).d, disco(ACTA).x, 'kibou', ACTA, DIA, soltar);
    assert.equal(soltados, 1);
    assert.equal(r.log[0], 'traefik separado');
  });

  it('con el silo en marcha: 409 y no borra nada', async () => {
    const { d, hechos } = falso([c('db'), c('backend', 'exited')], { vols, redes });
    assert.equal(await status(eliminar(d, disco(ACTA).x, 'kibou', ACTA, DIA)), 409);
    assert.deepEqual(hechos, []);
  });

  it('borra contenedores, volumenes, redes y respaldos solo del proyecto; devuelve el inventario', async () => {
    const { d, hechos } = falso(detenido(), { vols, redes });
    const ds = disco(`${ACTA.toUpperCase()}\n`, [
      { archivo: 'kibou-2026-11-01.dump.enc', bytes: 1000 },
      { archivo: 'kibou-2026-11-01.dump.enc.sha256', bytes: 64 },
    ]);
    const r = await eliminar(d, ds.x, 'kibou', ACTA, DIA);
    assert.deepEqual(r.inventario.volumenes, ['erp-kibou_db_data', 'erp-kibou_exportaciones']);
    assert.deepEqual(r.inventario.redes, ['erp-kibou_interna', 'erp-kibou_silo', 'erp-kibou_borde']);
    assert.equal(r.inventario.contenedores.length, 4);
    assert.deepEqual(r.inventario.respaldos, { archivos: 2, bytes: 1064 });
    assert.ok(!hechos.includes('rmvol erp-otro_db_data') && !hechos.includes('rmvol ajeno_db') && !hechos.includes('rmred proxy'));
    assert.deepEqual(ds.hechos, ['rm respaldos/kibou']);
    assert.ok(r.log.at(-1)!.includes('shred'));
  });

  it('idempotente: sin nada que borrar no falla', async () => {
    const r = await eliminar(falso([]).d, disco(ACTA, null).x, 'kibou', ACTA, DIA);
    assert.deepEqual(r.inventario, { contenedores: [], volumenes: [], redes: [], respaldos: { archivos: 0, bytes: 0 } });
  });

  it('reintento sin nada que borrar: el log trae lo que borro la corrida previa (auditoria local)', async () => {
    const inv = { contenedores: ['db aaa'], volumenes: ['erp-kibou_db_data'], redes: ['erp-kibou_borde'], respaldos: { archivos: 2, bytes: 10 } };
    const vacioInv = { contenedores: [], volumenes: [], redes: [], respaldos: { archivos: 0, bytes: 0 } };
    const auditoria = [
      JSON.stringify({ en: 'T1', verbo: 'eliminar', slug: 'kibou', ok: true, inventario: inv }),
      JSON.stringify({ en: 'T0', verbo: 'eliminar', slug: 'otro', ok: true, inventario: inv }),
      '{"cortada',
      JSON.stringify({ en: 'T2', verbo: 'eliminar', slug: 'kibou', ok: true, inventario: vacioInv }),
      JSON.stringify({ en: 'T3', verbo: 'eliminar', slug: 'kibou', ok: false, error: 'x' }),
    ].join('\n');
    assert.deepEqual(eliminacionPrevia(auditoria, 'kibou'), { en: 'T1', inventario: inv });
    assert.equal(eliminacionPrevia(auditoria, 'nadie'), null);
    const r = conPrevia(await eliminar(falso([]).d, disco(ACTA, null).x, 'kibou', ACTA, DIA), auditoria, 'kibou');
    assert.ok(r.log.at(-1)!.startsWith('eliminacion previa (T1): 1 contenedor(es); volumenes: erp-kibou_db_data'));
    // Una corrida que si borro no se toca.
    const conAlgo = { log: ['x'], inventario: inv };
    assert.equal(conPrevia(conAlgo, auditoria, 'kibou'), conAlgo);
  });

  it('hash invalido, slug invalido y ventana de respaldo', async () => {
    const { d } = falso(detenido());
    assert.equal(await status(eliminar(d, disco(ACTA).x, 'kibou', 'xyz', DIA)), 400);
    assert.equal(await status(eliminar(d, disco(ACTA).x, 'Kibou', ACTA, DIA)), 400);
    assert.equal(await status(eliminar(d, disco(ACTA).x, 'kibou', ACTA, VENTANA)), 409);
  });
});
