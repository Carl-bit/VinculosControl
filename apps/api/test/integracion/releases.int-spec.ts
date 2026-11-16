/**
 * Releases, ACTUALIZAR y cascada contra Postgres real (CONTEXTO.md seccion 7;
 * decisiones del usuario 2026-11-15): releases que detecta el agente con tags
 * inmutables, promocion demo -> beta -> estable, aprovisionar por canal,
 * ACTUALIZAR (U0, UC para un minor, cierre con version y digests) y la cascada
 * semiautomatica de a un silo.
 */
import type { OperadorSesion } from '../../src/acceso/acceso.service';
import * as pasos from '../../src/jobs/pasos';
import { contarAuditoria, crearAgente, crearCentroAprobado, crearEntorno, type Entorno, errorDe, limpiar, manifiestoValido, sesionDeOperador } from './entorno';

let e: Entorno;
let op: OperadorSesion;
let ventana: jest.SpyInstance;

beforeAll(async () => {
  e = await crearEntorno();
});
afterAll(() => e.cerrar());
beforeEach(async () => {
  await limpiar(e.prisma, e.correo);
  op = await sesionDeOperador(e.prisma);
  ventana = jest.spyOn(pasos, 'enVentanaRespaldo').mockReturnValue(false);
});
afterEach(() => ventana.mockRestore());

const d = (n: string) => `sha256:${n.repeat(64)}`;
const rel = (version: string, a = '1', w = '2') => ({ version, apiDigest: d(a), webDigest: d(w), commit: 'abcdef1', publicada: '2026-11-15T15:00:00Z' });

async function promover(version: string, hasta: 'demo' | 'beta' | 'estable') {
  for (const c of ['demo', 'beta', 'estable'] as const) {
    await e.releases.promover(version, c, op, null);
    if (c === hasta) return;
  }
}

/** Silo ACTIVO y adoptado, en un canal, corriendo `version` (como lo deja APROVISIONAR). */
async function siloActivo(slug: string, canal: string, version = '0.1.0') {
  const c = await crearCentroAprobado(e.prisma, slug, { ...manifiestoValido(slug), version: { canal } });
  await e.prisma.centro.update({ where: { id: c.id }, data: { estado: 'ACTIVO' } });
  await e.prisma.silo.create({ data: { slug, dominio: `${slug}.vinculos.cl`, adoptado: true, vistoEn: new Date(), version, apiDigest: d('1'), webDigest: d('2') } });
  return c;
}

async function correr(agenteId: number, jobId: number, codigos: string[]) {
  for (const codigo of codigos) {
    await e.jobs.reportarPaso(agenteId, jobId, codigo, 'EN_CURSO', []);
    await e.jobs.reportarPaso(agenteId, jobId, codigo, 'OK', [`${codigo} OK`]);
  }
}
const estadoJob = async (id: number) => (await e.prisma.job.findUniqueOrThrow({ where: { id } })).estado;

describe('releases', () => {
  it('el agente los informa; dos veces = una; otro digest para el mismo tag = conflicto (no se promueve)', async () => {
    const ag = await crearAgente(e.prisma);
    expect(await e.releases.registrar(ag.id, [rel('0.1.0'), rel('0.1.1', '3', '4')])).toEqual({ nuevas: 2, conflictos: 0 });
    expect(await e.releases.registrar(ag.id, [rel('0.1.0')])).toEqual({ nuevas: 0, conflictos: 0 });
    expect(await e.releases.registrar(ag.id, [rel('0.1.0', '9')])).toEqual({ nuevas: 0, conflictos: 1 });
    const r = await e.prisma.release.findUniqueOrThrow({ where: { version: '0.1.0' } });
    expect(r.apiDigest).toBe(d('1'));
    expect(r.conflicto).toMatch(/otros digests/);
    expect((await errorDe(e.releases.promover('0.1.0', 'demo', op, null))).status).toBe(422);
    expect(await contarAuditoria(e.prisma, 'release.conflicto')).toBe(1);
    expect((await e.releases.listar()).map((x) => x.version)).toEqual(['0.1.1', '0.1.0']);
  });

  it('promocion en orden; deCanal da la mayor version promovida', async () => {
    const ag = await crearAgente(e.prisma);
    await e.releases.registrar(ag.id, [rel('0.1.0'), rel('0.1.1', '3', '4'), rel('0.2.0', '5', '6')]);
    expect((await errorDe(e.releases.promover('0.1.1', 'beta', op, null))).status).toBe(422);
    await promover('0.1.0', 'estable');
    await promover('0.1.1', 'beta');
    await promover('0.2.0', 'demo');
    expect((await e.releases.deCanal('estable'))?.version).toBe('0.1.0');
    expect((await e.releases.deCanal('beta'))?.version).toBe('0.1.1');
    expect((await e.releases.deCanal('demo'))?.version).toBe('0.2.0');
    // Promover dos veces no cambia la fecha ni audita dos veces.
    await e.releases.promover('0.2.0', 'demo', op, null);
    expect(await contarAuditoria(e.prisma, 'release.promovida')).toBe(6);
  });

  it('aprovisionar por canal: P0 resuelve la version y la deja fija en el job', async () => {
    const ag = await crearAgente(e.prisma);
    await e.releases.registrar(ag.id, [rel('0.1.0'), rel('0.1.1', '3', '4')]);
    await promover('0.1.0', 'estable');
    const c = await crearCentroAprobado(e.prisma, 'kibou', { ...manifiestoValido('kibou'), version: { canal: 'estable' } });
    const job = await e.jobs.crear('APROVISIONAR', { centroId: c.id }, op, null);
    expect(job.estado).toBe('PENDIENTE');
    expect(job.referencia).toBe('0.1.0');
    // Promover otra version a estable no cambia el job ya encolado.
    await promover('0.1.1', 'estable');
    expect((await e.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).referencia).toBe('0.1.0');
  });

  it('aprovisionar con un canal sin versiones: P0 falla con la explicacion', async () => {
    const c = await crearCentroAprobado(e.prisma, 'kibou', { ...manifiestoValido('kibou'), version: { canal: 'beta' } });
    const job = await e.jobs.crear('APROVISIONAR', { centroId: c.id }, op, null);
    expect(job.estado).toBe('FALLIDO');
    expect(job.error).toMatch(/promovida al canal beta/);
  });
});

describe('ACTUALIZAR', () => {
  it('patch: UC omitido, va directo al agente; al terminar el silo registra la version y los digests', async () => {
    const ag = await crearAgente(e.prisma);
    await e.releases.registrar(ag.id, [rel('0.1.0'), rel('0.1.1', '3', '4')]);
    await promover('0.1.1', 'estable');
    await siloActivo('kibou', 'estable');
    expect((await errorDe(e.jobs.crearActualizar('kibou', '0.1.1', false, op, null))).status).toBe(422);
    const job = await e.jobs.crearActualizar('kibou', '0.1.1', true, op, null);
    expect(job.estado).toBe('PENDIENTE');
    expect(Object.fromEntries(job.pasos.map((p) => [p.codigo, p.estado]))).toMatchObject({ U0: 'OK', UC: 'OMITIDO', U1: 'PENDIENTE' });
    const r = await e.jobs.reclamar(ag.id, ['ACTUALIZAR']);
    expect(r?.referencia).toBe('0.1.1');
    expect(r?.pasos.map((p) => p.codigo)).toEqual(['U1', 'U2', 'U3', 'U4', 'U5', 'U6']);
    await correr(ag.id, job.id, ['U1', 'U2', 'U3', 'U4', 'U5', 'U6']);
    expect(await estadoJob(job.id)).toBe('OK');
    expect(await e.prisma.silo.findUniqueOrThrow({ where: { slug: 'kibou' } })).toMatchObject({ version: '0.1.1', apiDigest: d('3'), webDigest: d('4') });
    expect(await contarAuditoria(e.prisma, 'silo.actualizado')).toBe(1);
  });

  it('minor: espera la confirmacion por silo (UC) antes de llegar al agente', async () => {
    const ag = await crearAgente(e.prisma);
    await e.releases.registrar(ag.id, [rel('0.1.0'), rel('0.2.0', '5', '6')]);
    await promover('0.2.0', 'estable');
    await siloActivo('kibou', 'estable');
    const job = await e.jobs.crearActualizar('kibou', '0.2.0', true, op, null);
    expect(job.estado).toBe('ESPERANDO_OPERADOR');
    expect(await e.jobs.reclamar(ag.id, ['ACTUALIZAR'])).toBeNull();
    await e.jobs.confirmar(job.id, 'UC', '', op, null);
    expect(await estadoJob(job.id)).toBe('PENDIENTE');
    expect(await contarAuditoria(e.prisma, 'job.minor_confirmado')).toBe(1);
    expect((await e.jobs.reclamar(ag.id, ['ACTUALIZAR']))?.pasos[0].codigo).toBe('U1');
  });

  it('U0 rechaza: version no promovida al canal, hacia atras, manifiesto con version fija', async () => {
    const ag = await crearAgente(e.prisma);
    await e.releases.registrar(ag.id, [rel('0.1.0'), rel('0.1.1', '3', '4')]);
    await promover('0.1.1', 'beta');
    await siloActivo('kibou', 'estable');
    expect((await e.jobs.crearActualizar('kibou', '0.1.1', true, op, null)).error).toMatch(/no esta promovida al canal estable/);
    await limpiar(e.prisma, e.correo);
    op = await sesionDeOperador(e.prisma);
    await e.releases.registrar(ag.id, [rel('0.1.0')]);
    await promover('0.1.0', 'estable');
    await siloActivo('kibou', 'estable', '0.1.0');
    expect((await e.jobs.crearActualizar('kibou', '0.1.0', true, op, null)).error).toMatch(/solo se actualiza hacia adelante/);
  });

  it('R6: el operador escribe las notas de la version (auditadas; vacio las borra) y el job las lleva al agente para U6', async () => {
    const ag = await crearAgente(e.prisma);
    await e.releases.registrar(ag.id, [rel('0.1.0'), rel('0.1.1', '3', '4')]);
    await promover('0.1.1', 'estable');
    await siloActivo('kibou', 'estable');
    expect((await errorDe(e.releases.notas('9.9.9', 'x', op, null))).status).toBe(404);
    await e.releases.notas('0.1.1', '  Agenda: filtro por box.\r\nFichas: plantillas nuevas.  ', op, null);
    expect((await e.prisma.release.findUniqueOrThrow({ where: { version: '0.1.1' } })).notas).toBe('Agenda: filtro por box.\nFichas: plantillas nuevas.');
    expect(await contarAuditoria(e.prisma, 'release.notas')).toBe(1);
    await e.jobs.crearActualizar('kibou', '0.1.1', true, op, null);
    expect((await e.jobs.reclamar(ag.id, ['ACTUALIZAR']))?.notas).toBe('Agenda: filtro por box.\nFichas: plantillas nuevas.');
    await e.releases.notas('0.1.1', '   ', op, null);
    expect(await e.prisma.release.findUniqueOrThrow({ where: { version: '0.1.1' } })).toMatchObject({ notas: null, notasPor: null });
  });

  it('R13: con el silo informando, un exporte en curso bloquea (409 y U0) y sin el no hace falta la confirmacion', async () => {
    const ag = await crearAgente(e.prisma);
    await e.releases.registrar(ag.id, [rel('0.1.0'), rel('0.1.1', '3', '4')]);
    await promover('0.1.1', 'estable');
    await siloActivo('kibou', 'estable');
    const exp = { id: '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5', estado: 'EN_PROCESO', creadaEn: '2026-11-16T12:00:00Z' };
    await e.exportaciones.sincronizar('kibou', [exp]);
    expect((await errorDe(e.jobs.crearActualizar('kibou', '0.1.1', true, op, null))).status).toBe(409);
    // Termina: ya no bloquea y no pide la confirmacion del operador (sinExporte = false).
    await e.exportaciones.sincronizar('kibou', [{ ...exp, estado: 'LISTA', terminadaEn: '2026-11-16T12:05:00Z', bytes: 2048, huella: 'e'.repeat(64) }]);
    const job = await e.jobs.crearActualizar('kibou', '0.1.1', false, op, null);
    expect(job.pasos.find((p) => p.codigo === 'U0')?.log).toContain('sin exportacion en curso (informado por el silo, R13)');
    // Un exporte que empieza despues de crear el job: el reintento de U0 lo ve.
    await e.exportaciones.sincronizar('kibou', [{ ...exp, id: '7f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5', estado: 'PENDIENTE' }]);
    const p0 = await e.actualizar.p0(await e.prisma.job.findUniqueOrThrow({ where: { id: job.id } }));
    expect(p0.error).toMatch(/exportacion PENDIENTE/);
    // Lectura vencida (el agente no informa hace mas de 10 min): vuelve a pedir la confirmacion.
    await e.prisma.silo.update({ where: { slug: 'kibou' }, data: { exportesVistoEn: new Date(Date.now() - 11 * 60_000) } });
    expect(await e.exportaciones.estado('kibou')).toEqual({ informa: false, enCurso: null });
    expect((await e.exportaciones.listar('kibou')).exportaciones.map((x) => x.estado).sort()).toEqual(['LISTA', 'PENDIENTE']);
  });
});

describe('cascada', () => {
  it('un silo a la vez: el siguiente parte cuando el anterior termina OK; termina con el ultimo', async () => {
    const ag = await crearAgente(e.prisma);
    await e.releases.registrar(ag.id, [rel('0.1.0'), rel('0.1.1', '3', '4')]);
    await promover('0.1.1', 'estable');
    await siloActivo('alfa', 'estable');
    await siloActivo('beta-centro', 'estable');
    await siloActivo('demo-centro', 'demo');
    const c = await e.jobs.crearCascada('0.1.1', 'estable', true, op, null);
    expect(c.silos).toEqual(['alfa', 'beta-centro']);
    const primero = await e.prisma.job.findFirstOrThrow({ where: { cascadaId: c.id } });
    expect(primero.siloSlug).toBe('alfa');
    expect(await e.prisma.job.count({ where: { cascadaId: c.id } })).toBe(1);
    await e.jobs.reclamar(ag.id, ['ACTUALIZAR']);
    await correr(ag.id, primero.id, ['U1', 'U2', 'U3', 'U4', 'U5', 'U6']);
    const segundo = await e.prisma.job.findFirstOrThrow({ where: { cascadaId: c.id, siloSlug: 'beta-centro' } });
    await e.jobs.reclamar(ag.id, ['ACTUALIZAR']);
    await correr(ag.id, segundo.id, ['U1', 'U2', 'U3', 'U4', 'U5', 'U6']);
    expect(await e.prisma.cascada.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ estado: 'TERMINADA', indice: 2 });
    expect((await e.prisma.silo.findUniqueOrThrow({ where: { slug: 'demo-centro' } })).version).toBe('0.1.0');
  });

  it('si un silo falla la cascada se detiene; al reintentar y terminar OK, sigue con el siguiente', async () => {
    const ag = await crearAgente(e.prisma);
    await e.releases.registrar(ag.id, [rel('0.1.0'), rel('0.1.1', '3', '4')]);
    await promover('0.1.1', 'estable');
    await siloActivo('alfa', 'estable');
    await siloActivo('omega', 'estable');
    const c = await e.jobs.crearCascada('0.1.1', 'estable', true, op, null);
    const primero = await e.prisma.job.findFirstOrThrow({ where: { cascadaId: c.id } });
    await e.jobs.reclamar(ag.id, ['ACTUALIZAR']);
    await correr(ag.id, primero.id, ['U1', 'U2']);
    await e.jobs.reportarPaso(ag.id, primero.id, 'U3', 'EN_CURSO', []);
    await e.jobs.reportarPaso(ag.id, primero.id, 'U3', 'FALLIDO', ['migrate 1', 'revertido a 0.1.0'], 'migrate termino con 1');
    expect((await e.prisma.cascada.findUniqueOrThrow({ where: { id: c.id } })).estado).toBe('DETENIDA');
    expect(await e.prisma.job.count({ where: { cascadaId: c.id } })).toBe(1);
    // El reintento rehace desde U2: el fallo en U3 ya habia vuelto el silo a la imagen anterior.
    await e.jobs.reintentar(primero.id, op, null);
    const r = await e.jobs.reclamar(ag.id, ['ACTUALIZAR']);
    expect(r?.pasos.filter((p) => p.estado !== 'OK').map((p) => p.codigo)).toEqual(['U2', 'U3', 'U4', 'U5', 'U6']);
    await correr(ag.id, primero.id, ['U2', 'U3', 'U4', 'U5', 'U6']);
    expect(await e.prisma.cascada.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ estado: 'EN_CURSO', indice: 1 });
    expect(await e.prisma.job.count({ where: { cascadaId: c.id, siloSlug: 'omega' } })).toBe(1);
  });

  it('sin silos por debajo de la version o con otra cascada en curso: no se crea', async () => {
    const ag = await crearAgente(e.prisma);
    await e.releases.registrar(ag.id, [rel('0.1.0'), rel('0.1.1', '3', '4')]);
    await promover('0.1.1', 'estable');
    expect((await errorDe(e.jobs.crearCascada('0.1.1', 'estable', true, op, null))).status).toBe(422);
    await siloActivo('alfa', 'estable');
    // Sin confirmacion y con un silo que no informa R13: la cascada se detiene en ese silo.
    expect((await e.jobs.crearCascada('0.1.1', 'estable', false, op, null)).estado).toBe('DETENIDA');
    expect(await e.prisma.job.count()).toBe(0);
    await e.jobs.crearCascada('0.1.1', 'estable', true, op, null);
    expect((await errorDe(e.jobs.crearCascada('0.1.1', 'estable', true, op, null))).status).toBe(409);
  });
});
