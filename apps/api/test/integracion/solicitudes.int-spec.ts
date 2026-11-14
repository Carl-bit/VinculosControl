/**
 * Tarea 31 de punta a punta contra Postgres real: el silo reporta (R2), el
 * operador decide, aprobar crea revision + job RECONFIGURAR, el agente corre
 * C1/C2, el job cierra la solicitud en APLICADA y la respuesta vuelve al
 * silo de a un paso (R3).
 */
import { hashManifiesto } from '@vinculos/manifest/hash';

import type { OperadorSesion } from '../../src/acceso/acceso.service';
import * as pasos from '../../src/jobs/pasos';
import type { SolicitudDelSilo } from '../../src/solicitudes/solicitudes.service';
import { contarAuditoria, crearAgente, crearCentroAprobado, crearEntorno, crearSilo, type Entorno, errorDe, limpiar, sesionDeOperador } from './entorno';

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

const desactivarMatch = (estado: SolicitudDelSilo['estado'] = 'PENDIENTE'): SolicitudDelSilo => ({
  id: 'sol-1',
  modulo: 'MATCH',
  accion: 'DESACTIVAR',
  pedidaPorRol: 'ADMIN',
  pedidaEn: '2026-11-14T12:00:00.000Z',
  estado,
});

const fila = () => e.prisma.solicitudModulo.findUniqueOrThrow({ where: { siloSlug_id: { siloSlug: 'kibou', id: 'sol-1' } } });

/** El agente corre el job RECONFIGURAR (C1 aplicar, C2 confirmar) como si el silo respondiera bien. */
async function correrReconfigurar(jobId: number) {
  const ag = await crearAgente(e.prisma);
  const r = await e.jobs.reclamar(ag.id, ['RECONFIGURAR']);
  expect(r!.id).toBe(jobId);
  for (const c of ['C1', 'C2']) {
    await e.jobs.reportarPaso(ag.id, jobId, c, 'EN_CURSO', []);
    await e.jobs.reportarPaso(ag.id, jobId, c, 'OK', [`${c} OK`]);
  }
}

describe('solicitudes de modulo: sincronizar (R2/R3)', () => {
  it('silo desconocido: 404', async () => {
    expect((await errorDe(e.solicitudes.sincronizar('kibou', [desactivarMatch()], []))).status).toBe(404);
  });

  it('sincronizar dos veces lo mismo no duplica ni tiene respuestas que entregar', async () => {
    await crearSilo(e.prisma);
    const a = await e.solicitudes.sincronizar('kibou', [desactivarMatch()], []);
    const b = await e.solicitudes.sincronizar('kibou', [desactivarMatch()], []);
    expect(await e.prisma.solicitudModulo.count()).toBe(1);
    expect(a).toEqual({ respuestas: [] });
    expect(b).toEqual({ respuestas: [] });
  });
});

describe('solicitudes de modulo: con manifiesto aprobado (automatica)', () => {
  it('aprobar -> revision nueva + RECONFIGURAR -> job OK -> APLICADA, entregada al silo de a un paso', async () => {
    await crearSilo(e.prisma);
    const c = await crearCentroAprobado(e.prisma);
    await e.solicitudes.sincronizar('kibou', [desactivarMatch()], []);

    const d = (await e.solicitudes.decidir('kibou', 'sol-1', 'APROBADA', 'ok', op)) as { reconfigurar: { jobId: number | null; motivo: string } };
    expect(d.reconfigurar.jobId).not.toBeNull();

    // Revision 2 (fase 3) sin MATCH, con su hash, y es la aprobada.
    const rev2 = await e.prisma.revisionManifiesto.findUniqueOrThrow({ where: { centroId_numero: { centroId: c.id, numero: 2 } } });
    expect(rev2.fase).toBe(3);
    expect((rev2.contenido as { modulos: string[] }).modulos).toEqual(['AGENDA', 'EQUIPO', 'FICHAS']);
    expect(rev2.hash).toBe(hashManifiesto(rev2.contenido));
    const centro = await e.prisma.centro.findUniqueOrThrow({ where: { id: c.id } });
    expect([centro.revisionAprobada, centro.hashAprobado]).toEqual([2, rev2.hash]);
    const job = await e.prisma.job.findUniqueOrThrow({ where: { id: d.reconfigurar.jobId! } });
    expect([job.tipo, job.estado, job.revision]).toEqual(['RECONFIGURAR', 'PENDIENTE', 2]);

    // El silo aun no confirma: aplicar a mano no corre, y la respuesta pendiente es APROBADA.
    expect((await errorDe(e.solicitudes.aplicar('kibou', 'sol-1', op))).status).toBe(409);
    expect((await e.solicitudes.sincronizar('kibou', [desactivarMatch()], [])).respuestas).toEqual([{ id: 'sol-1', estado: 'APROBADA', respuesta: 'ok' }]);
    expect((await e.solicitudes.sincronizar('kibou', [desactivarMatch('APROBADA')], [])).respuestas).toEqual([]);

    // "Aplicar con RECONFIGURAR" con el job aun activo: no crea otra revision (y el job no se duplica).
    expect((await errorDe(e.solicitudes.aplicar('kibou', 'sol-1', op))).status).toBe(422);
    expect(await e.prisma.revisionManifiesto.count({ where: { centroId: c.id } })).toBe(2);
    expect(await e.prisma.job.count()).toBe(1);

    await correrReconfigurar(job.id);
    expect((await fila()).estado).toBe('APLICADA');
    expect(await contarAuditoria(e.prisma, 'modulo.solicitud_aplicada')).toBe(1);
    expect((await e.solicitudes.sincronizar('kibou', [desactivarMatch('APROBADA')], [])).respuestas).toEqual([{ id: 'sol-1', estado: 'APLICADA', respuesta: 'ok' }]);
    expect((await e.solicitudes.sincronizar('kibou', [desactivarMatch('APLICADA')], [])).respuestas).toEqual([]);
  });

  it('aplicar una aprobacion que quedo sin job: si la revision ya refleja el cambio, no crea otra', async () => {
    await crearSilo(e.prisma);
    const c = await crearCentroAprobado(e.prisma);
    await e.solicitudes.sincronizar('kibou', [desactivarMatch()], []);
    const d = (await e.solicitudes.decidir('kibou', 'sol-1', 'APROBADA', undefined, op)) as { reconfigurar: { jobId: number } };
    await e.jobs.cancelar(d.reconfigurar.jobId, op, null);
    await e.solicitudes.sincronizar('kibou', [desactivarMatch('APROBADA')], []);

    const r = await e.solicitudes.aplicar('kibou', 'sol-1', op);
    expect(r.reconfigurar.jobId).not.toBe(d.reconfigurar.jobId);
    expect(await e.prisma.revisionManifiesto.count({ where: { centroId: c.id } })).toBe(2);
    // Dos veces: ahora hay job activo, no se crea ni revision ni job.
    expect((await errorDe(e.solicitudes.aplicar('kibou', 'sol-1', op))).status).toBe(422);
    expect(await e.prisma.revisionManifiesto.count({ where: { centroId: c.id } })).toBe(2);
    expect(await e.prisma.job.count({ where: { estado: 'PENDIENTE' } })).toBe(1);
  });

  it('marcar APLICADA a mano con centro aprobado: 409 (la marca el job)', async () => {
    await crearSilo(e.prisma);
    await crearCentroAprobado(e.prisma);
    await e.solicitudes.sincronizar('kibou', [desactivarMatch()], []);
    await e.solicitudes.decidir('kibou', 'sol-1', 'APROBADA', undefined, op);
    await e.solicitudes.sincronizar('kibou', [desactivarMatch('APROBADA')], []);
    expect((await errorDe(e.solicitudes.decidir('kibou', 'sol-1', 'APLICADA', undefined, op))).status).toBe(409);
  });

  it('si el silo rechaza APLICADA con 4xx, vuelve a APROBADA con el motivo; un 5xx se reintenta', async () => {
    await crearSilo(e.prisma);
    await crearCentroAprobado(e.prisma);
    await e.solicitudes.sincronizar('kibou', [desactivarMatch()], []);
    const d = (await e.solicitudes.decidir('kibou', 'sol-1', 'APROBADA', undefined, op)) as { reconfigurar: { jobId: number } };
    await e.solicitudes.sincronizar('kibou', [desactivarMatch('APROBADA')], []);
    await correrReconfigurar(d.reconfigurar.jobId);

    await e.solicitudes.sincronizar('kibou', [desactivarMatch('APROBADA')], [{ id: 'sol-1', error: 'HTTP 503 no disponible' }]);
    expect((await fila()).estado).toBe('APLICADA');

    const r = await e.solicitudes.sincronizar('kibou', [desactivarMatch('APROBADA')], [{ id: 'sol-1', error: 'HTTP 422 los modulos no reflejan la solicitud' }]);
    const f = await fila();
    expect(f.estado).toBe('APROBADA');
    expect(f.errorEntrega).toMatch(/^El silo rechazo APLICADA/);
    expect(r.respuestas).toEqual([]);
    expect(await contarAuditoria(e.prisma, 'modulo.solicitud_revertida')).toBe(1);
  });
});

describe('solicitudes de modulo: silo sin centro aprobado (manual)', () => {
  it('aprobar no crea job y dice por que; despues se puede marcar aplicada a mano', async () => {
    await crearSilo(e.prisma);
    await e.solicitudes.sincronizar('kibou', [desactivarMatch()], []);
    const d = (await e.solicitudes.decidir('kibou', 'sol-1', 'APROBADA', undefined, op)) as { reconfigurar: { jobId: number | null; motivo: string } };
    expect(d.reconfigurar.jobId).toBeNull();
    expect(d.reconfigurar.motivo).toMatch(/a mano/);
    expect(await e.prisma.job.count()).toBe(0);

    // Antes de que el silo confirme APROBADA no se puede seguir decidiendo.
    expect((await errorDe(e.solicitudes.decidir('kibou', 'sol-1', 'APLICADA', undefined, op))).status).toBe(400);
    await e.solicitudes.sincronizar('kibou', [desactivarMatch('APROBADA')], []);
    await e.solicitudes.decidir('kibou', 'sol-1', 'APLICADA', undefined, op);
    expect((await fila()).estado).toBe('APLICADA');
  });

  it('transiciones invalidas y decisiones repetidas', async () => {
    await crearSilo(e.prisma);
    await e.solicitudes.sincronizar('kibou', [desactivarMatch()], []);
    expect((await errorDe(e.solicitudes.decidir('kibou', 'sol-1', 'APLICADA', undefined, op))).status).toBe(409);
    await e.solicitudes.decidir('kibou', 'sol-1', 'RECHAZADA', 'no por ahora', op);
    // Repetir la misma decision es idempotente.
    await e.solicitudes.decidir('kibou', 'sol-1', 'RECHAZADA', 'no por ahora', op);
    expect(await contarAuditoria(e.prisma, 'modulo.solicitud_decidida')).toBe(1);
    expect((await errorDe(e.solicitudes.decidir('kibou', 'nada', 'RECHAZADA', undefined, op))).status).toBe(404);
  });
});
