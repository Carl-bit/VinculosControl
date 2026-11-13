import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  conectarBorde,
  type Contenedor,
  contenedoresBorde,
  type Docker,
  enVentanaRespaldo,
  ErrorVerbo,
  estado,
  reconectarBordes,
  type Red,
  reiniciar,
  soltarBorde,
  validarSlug,
} from './verbos';

const c = (id: string, servicio: string, proyecto = 'erp-kibou'): Contenedor => ({
  Id: id.padEnd(12, '0'),
  Labels: { 'com.docker.compose.project': proyecto, 'com.docker.compose.service': servicio },
  State: 'running',
  Status: 'Up 1 hour',
});

const ID_TRAEFIK = 'a'.repeat(64);
const ID_AGENTE = 'b'.repeat(64);
const NOMBRES: Record<string, string> = { traefik: ID_TRAEFIK, agente: ID_AGENTE };

const borde = (slug: string, unidos: string[] = [], labels?: Record<string, string>): Red => ({
  Id: 'f'.repeat(64),
  Name: `erp-${slug}_borde`,
  Labels: labels ?? { 'cl.vinculos.red': 'borde', 'cl.vinculos.silo': slug },
  Containers: Object.fromEntries(unidos.map((id) => [id, {}])),
});

function falso(contenedores: Contenedor[], redes: Red[] = []) {
  const reiniciados: string[] = [];
  const pedidos: string[] = [];
  const conexiones: string[] = [];
  const d: Docker = {
    async red(nombre) {
      return redes.find((r) => r.Name === nombre) ?? null;
    },
    async redesBorde() {
      return redes.filter((r) => r.Labels['cl.vinculos.red'] === 'borde');
    },
    async contenedorId(nombre) {
      return NOMBRES[nombre] ?? null;
    },
    async conectar(red, id) {
      conexiones.push(`+${red.slice(0, 4)}:${id.slice(0, 4)}`);
    },
    async desconectar(red, id) {
      conexiones.push(`-${red.slice(0, 4)}:${id.slice(0, 4)}`);
    },
    async listar(p) {
      pedidos.push(p);
      return contenedores.filter((x) => x.Labels['com.docker.compose.project'] === p);
    },
    async reiniciar(id) {
      reiniciados.push(id);
    },
    async salud() {
      return 'healthy';
    },
  };
  return { d, reiniciados, pedidos, conexiones };
}

// 12:00 en Chile (fuera de la ventana de respaldo).
const mediodia = new Date('2026-11-12T15:00:00Z');

describe('verbos del ejecutor', () => {
  it('slug: solo minusculas, numeros y guiones (nada de rutas ni comandos)', () => {
    assert.equal(validarSlug('kibou'), 'kibou');
    for (const malo of ['../etc', 'erp;rm -rf', 'Kibou', 'a', 'x'.repeat(41), 'kibou-']) assert.throws(() => validarSlug(malo), ErrorVerbo);
  });

  it('reiniciar: backend antes que frontend y nunca db', async () => {
    const { d, reiniciados } = falso([c('aaa', 'frontend'), c('bbb', 'db'), c('ccc', 'backend')]);
    const log = await reiniciar(d, 'kibou', mediodia);
    assert.deepEqual(reiniciados, ['ccc000000000', 'aaa000000000']);
    assert.equal(log.length, 2);
  });

  it('reiniciar: solo el proyecto erp-<slug> pedido', async () => {
    const { d, reiniciados, pedidos } = falso([c('aaa', 'backend', 'erp-otro')]);
    await assert.rejects(reiniciar(d, 'kibou', mediodia), /no tiene backend ni frontend/);
    assert.deepEqual(pedidos, ['erp-kibou']);
    assert.deepEqual(reiniciados, []);
  });

  it('no actua en la ventana de respaldo (01:45 a 02:30 Chile)', async () => {
    const dos = new Date('2026-11-12T05:00:00Z'); // 02:00 en Chile (UTC-3)
    assert.equal(enVentanaRespaldo(dos), true);
    assert.equal(enVentanaRespaldo(mediodia), false);
    const { d, reiniciados } = falso([c('ccc', 'backend')]);
    await assert.rejects(reiniciar(d, 'kibou', dos), /ventana de respaldo/);
    assert.deepEqual(reiniciados, []);
  });

  it('estado: servicio, estado y salud', async () => {
    const { d } = falso([c('ccc', 'backend'), c('bbb', 'db')]);
    assert.deepEqual(
      (await estado(d, 'kibou')).map((x) => [x.servicio, x.estado, x.salud]),
      [
        ['backend', 'running', 'healthy'],
        ['db', 'running', 'healthy'],
      ],
    );
  });

  it('borde: lista fija valida (sin rutas ni comandos)', () => {
    assert.deepEqual(contenedoresBorde(' traefik , agente '), ['traefik', 'agente']);
    assert.deepEqual(contenedoresBorde(undefined), []);
    assert.throws(() => contenedoresBorde('traefik;rm -rf /'));
  });

  it('conectar_borde: une solo a quien falta e idempotente', async () => {
    const { d, conexiones } = falso([], [borde('kibou', [ID_TRAEFIK])]);
    const log = await conectarBorde(d, 'kibou', ['traefik', 'agente']);
    assert.deepEqual(conexiones, ['+ffff:bbbb']);
    assert.match(log[0], /ya estaba/);
  });

  it('conectar_borde: nunca a una red sin las labels de borde del silo', async () => {
    const ajena = borde('kibou', [], { 'cl.vinculos.red': 'borde', 'cl.vinculos.silo': 'otro' });
    const { d, conexiones } = falso([], [ajena]);
    await assert.rejects(conectarBorde(d, 'kibou', ['traefik']), /labels de borde/);
    const sinLabel = falso([], [borde('kibou', [], {})]);
    await assert.rejects(conectarBorde(sinLabel.d, 'kibou', ['traefik']), /labels de borde/);
    assert.deepEqual(conexiones, []);
  });

  it('conectar_borde: red inexistente o lista vacia -> error sin tocar nada', async () => {
    const { d, conexiones } = falso([]);
    await assert.rejects(conectarBorde(d, 'kibou', ['traefik']), /no existe/);
    await assert.rejects(conectarBorde(d, 'kibou', []), /vacio/);
    await assert.rejects(conectarBorde(d, '../etc', ['traefik']), ErrorVerbo);
    assert.deepEqual(conexiones, []);
  });

  it('soltar_borde: separa solo a los unidos; sin red no falla', async () => {
    const { d, conexiones } = falso([], [borde('kibou', [ID_TRAEFIK])]);
    await soltarBorde(d, 'kibou', ['traefik', 'agente']);
    assert.deepEqual(conexiones, ['-ffff:aaaa']);
    assert.match((await soltarBorde(falso([]).d, 'kibou', ['traefik']))[0], /nada que soltar/);
  });

  it('reconectar_bordes: todas las redes de borde, omite las inconsistentes', async () => {
    const rara = { ...borde('x1', []), Name: 'otra_red' };
    const { d, conexiones } = falso([], [borde('kibou'), borde('demo', [ID_TRAEFIK]), rara]);
    const log = await reconectarBordes(d, ['traefik']);
    assert.deepEqual(conexiones, ['+ffff:aaaa']);
    assert.ok(log.some((l) => /inconsistentes/.test(l)));
  });
});
