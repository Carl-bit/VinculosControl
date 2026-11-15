/**
 * Cola de jobs contra Postgres real: P0 en el plano de control, reclamo con
 * FOR UPDATE SKIP LOCKED, reserva y retoma, reporte por paso, cancelar,
 * reintentar desde el paso fallido e idempotencia de los reportes.
 */
import type { OperadorSesion } from '../../src/acceso/acceso.service';
import * as pasos from '../../src/jobs/pasos';
import { contarAuditoria, crearAgente, crearCentroAprobado, crearEntorno, crearSilo, type Entorno, errorDe, limpiar, manifiestoValido, sesionDeOperador } from './entorno';

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
  // Por defecto fuera de la ventana de respaldo, para que la hora real no cambie el resultado.
  ventana = jest.spyOn(pasos, 'enVentanaRespaldo').mockReturnValue(false);
});
afterEach(() => ventana.mockRestore());

const AGENTE = ['VERIFICAR', 'REINICIAR_SILO', 'RECONFIGURAR'] as const;
const reclamar = (agenteId: number) => e.jobs.reclamar(agenteId, [...AGENTE]);

/** Reporta un paso como lo hace el agente: EN_CURSO y luego el estado final. */
async function correrPaso(agenteId: number, jobId: number, codigo: string, estado: 'OK' | 'FALLIDO' = 'OK') {
  await e.jobs.reportarPaso(agenteId, jobId, codigo, 'EN_CURSO', []);
  return e.jobs.reportarPaso(agenteId, jobId, codigo, estado, [`${codigo} ${estado}`], estado === 'FALLIDO' ? 'disco al 84 %' : undefined);
}

async function verificarEncolado() {
  const c = await crearCentroAprobado(e.prisma);
  const job = await e.jobs.crear('VERIFICAR', { centroId: c.id }, op, null);
  return { c, job };
}

const estadoJob = async (id: number) => (await e.prisma.job.findUniqueOrThrow({ where: { id } })).estado;
const estadosPasos = async (id: number) =>
  Object.fromEntries((await e.prisma.pasoJob.findMany({ where: { jobId: id }, orderBy: { orden: 'asc' } })).map((p) => [p.codigo, p.estado]));

describe('jobs: P0 al crear', () => {
  it('sin manifiesto aprobado el job no se crea', async () => {
    const c = await e.prisma.centro.create({ data: { nombre: 'X', contactoNombre: 'X', contactoCorreo: 'x@x.cl', comuna: 'X', origen: 'formulario' } });
    expect((await errorDe(e.jobs.crear('VERIFICAR', { centroId: c.id }, op, null))).status).toBe(422);
    expect(await e.prisma.job.count()).toBe(0);
  });

  it('con P0 ok queda PENDIENTE para el agente; un segundo job del mismo centro: 409', async () => {
    const { c, job } = await verificarEncolado();
    expect(job.estado).toBe('PENDIENTE');
    expect(await estadosPasos(job.id)).toEqual({ P0: 'OK', V1: 'PENDIENTE', V2: 'PENDIENTE', V3: 'PENDIENTE', V4: 'PENDIENTE', V5: 'PENDIENTE' });
    expect((await errorDe(e.jobs.crear('VERIFICAR', { centroId: c.id }, op, null))).status).toBe(409);
  });

  it('manifiesto aprobado que no pasa el schema (MATCH sin EQUIPO): el job queda FALLIDO en P0', async () => {
    const c = await crearCentroAprobado(e.prisma, 'kibou', manifiestoValido('kibou', ['MATCH']));
    const job = await e.jobs.crear('VERIFICAR', { centroId: c.id }, op, null);
    expect(job.estado).toBe('FALLIDO');
    expect(await reclamar((await crearAgente(e.prisma)).id)).toBeNull();
  });

  it('revision alterada despues de aprobar: el hash no coincide y P0 falla', async () => {
    const c = await crearCentroAprobado(e.prisma);
    await e.prisma.revisionManifiesto.updateMany({ data: { contenido: manifiestoValido('kibou', ['AGENDA']) } });
    const job = await e.jobs.crear('VERIFICAR', { centroId: c.id }, op, null);
    expect(job.estado).toBe('FALLIDO');
    expect(job.error).toMatch(/hash/);
  });

  it('tipos bloqueados no se encolan', async () => {
    const c = await crearCentroAprobado(e.prisma);
    expect((await errorDe(e.jobs.crear('ACTUALIZAR', { centroId: c.id }, op, null))).status).toBe(422);
  });
});

describe('jobs: P0 de los jobs sobre un silo', () => {
  it('silo que el agente no reporta: 404', async () => {
    expect((await errorDe(e.jobs.crear('REINICIAR_SILO', { siloSlug: 'nadie' }, op, null))).status).toBe(404);
  });

  it('silo sin reporte hace mas de 10 min: FALLIDO en P0', async () => {
    await crearSilo(e.prisma, 'kibou', new Date(Date.now() - 11 * 60_000));
    const job = await e.jobs.crear('REINICIAR_SILO', { siloSlug: 'kibou' }, op, null);
    expect(job.estado).toBe('FALLIDO');
    expect(job.error).toMatch(/10 min/);
  });

  it('en la ventana de respaldo: FALLIDO en P0', async () => {
    ventana.mockReturnValue(true);
    await crearSilo(e.prisma);
    const job = await e.jobs.crear('REINICIAR_SILO', { siloSlug: 'kibou' }, op, null);
    expect(job.estado).toBe('FALLIDO');
    expect(job.error).toMatch(/respaldo/);
  });
});

describe('jobs: reclamo (FOR UPDATE SKIP LOCKED)', () => {
  it('dos agentes reclaman a la vez un unico job: solo uno lo obtiene', async () => {
    const { job } = await verificarEncolado();
    const [a, b] = [await crearAgente(e.prisma, 'a'), await crearAgente(e.prisma, 'b')];
    const r = await Promise.all([reclamar(a.id), reclamar(b.id)]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(r.find(Boolean)!.id).toBe(job.id);
    expect(await contarAuditoria(e.prisma, 'job.reclamado')).toBe(1);
  });

  it('con dos jobs, cada agente obtiene uno distinto', async () => {
    await verificarEncolado();
    await crearSilo(e.prisma, 'otro');
    await e.jobs.crear('REINICIAR_SILO', { siloSlug: 'otro' }, op, null);
    const [a, b] = [await crearAgente(e.prisma, 'a'), await crearAgente(e.prisma, 'b')];
    const r = await Promise.all([reclamar(a.id), reclamar(b.id)]);
    expect(new Set(r.map((x) => x?.id)).size).toBe(2);
  });

  it('el agente recibe solo sus pasos y el manifiesto aprobado', async () => {
    const { job } = await verificarEncolado();
    const r = await reclamar((await crearAgente(e.prisma)).id);
    expect(r!.id).toBe(job.id);
    expect(r!.pasos.map((p) => p.codigo)).toEqual(['V1', 'V2', 'V3', 'V4', 'V5']);
    expect(r!.manifiesto).toEqual(manifiestoValido());
  });

  it('un tipo que el agente no sabe ejecutar no se reclama', async () => {
    await verificarEncolado();
    expect(await e.jobs.reclamar((await crearAgente(e.prisma)).id, ['REINICIAR_SILO'])).toBeNull();
  });

  it('con la reserva vigente nadie mas lo toma; vencida, otro agente lo retoma desde el paso pendiente', async () => {
    const { job } = await verificarEncolado();
    const [a, b] = [await crearAgente(e.prisma, 'a'), await crearAgente(e.prisma, 'b')];
    await reclamar(a.id);
    await correrPaso(a.id, job.id, 'V1');
    await e.jobs.reportarPaso(a.id, job.id, 'V2', 'EN_CURSO', []);
    expect(await reclamar(b.id)).toBeNull();

    // El agente A muere: vence su reserva.
    await e.prisma.job.update({ where: { id: job.id }, data: { reservaHasta: new Date(Date.now() - 1000) } });
    const r = await reclamar(b.id);
    expect(r!.id).toBe(job.id);
    expect(r!.pasos).toEqual([
      { codigo: 'V1', estado: 'OK' },
      { codigo: 'V2', estado: 'PENDIENTE' },
      { codigo: 'V3', estado: 'PENDIENTE' },
      { codigo: 'V4', estado: 'PENDIENTE' },
      { codigo: 'V5', estado: 'PENDIENTE' },
    ]);
    const fila = await e.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(fila.agenteId).toBe(b.id);
    expect(fila.intentos).toBe(2);

    // El agente A vuelve: ya no es suyo.
    expect((await errorDe(e.jobs.reportarPaso(a.id, job.id, 'V2', 'OK', []))).status).toBe(403);
  });
});

describe('jobs: reportes de pasos', () => {
  it('todos los pasos OK cierran el job OK y renuevan la reserva', async () => {
    const { job } = await verificarEncolado();
    const ag = await crearAgente(e.prisma);
    await reclamar(ag.id);
    await e.prisma.job.update({ where: { id: job.id }, data: { reservaHasta: new Date(Date.now() + 1000) } });
    await correrPaso(ag.id, job.id, 'V1');
    expect((await e.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).reservaHasta!.getTime()).toBeGreaterThan(Date.now() + 60_000);
    for (const c of ['V2', 'V3', 'V4', 'V5']) await correrPaso(ag.id, job.id, c);
    expect(await estadoJob(job.id)).toBe('OK');
    expect(await contarAuditoria(e.prisma, 'job.ok')).toBe(1);
  });

  it('idempotencia: el mismo paso reportado dos veces deja el mismo estado y no duplica el cierre', async () => {
    const { job } = await verificarEncolado();
    const ag = await crearAgente(e.prisma);
    await reclamar(ag.id);
    await correrPaso(ag.id, job.id, 'V1');
    const antes = await estadosPasos(job.id);
    await e.jobs.reportarPaso(ag.id, job.id, 'V1', 'OK', ['V1 OK']);
    expect(await estadosPasos(job.id)).toEqual(antes);
    expect(await estadoJob(job.id)).toBe('EN_CURSO');

    for (const c of ['V2', 'V3', 'V4', 'V5']) await correrPaso(ag.id, job.id, c);
    // Repetir el ultimo reporte (p. ej. el agente no recibio la respuesta): 409 y el agente se detiene.
    const r = await errorDe(e.jobs.reportarPaso(ag.id, job.id, 'V5', 'OK', []));
    expect(r.status).toBe(409);
    expect(r.cuerpo.detener).toBe(true);
    expect(await estadoJob(job.id)).toBe('OK');
    expect(await contarAuditoria(e.prisma, 'job.ok')).toBe(1);
  });

  it('un paso que no es del agente (P0 o desconocido): 404', async () => {
    const { job } = await verificarEncolado();
    const ag = await crearAgente(e.prisma);
    await reclamar(ag.id);
    expect((await errorDe(e.jobs.reportarPaso(ag.id, job.id, 'P0', 'OK', []))).status).toBe(404);
    expect((await errorDe(e.jobs.reportarPaso(ag.id, job.id, 'X9', 'OK', []))).status).toBe(404);
  });

  it('el log se recorta (sin saltos, lineas cortas)', async () => {
    const { job } = await verificarEncolado();
    const ag = await crearAgente(e.prisma);
    await reclamar(ag.id);
    await e.jobs.reportarPaso(ag.id, job.id, 'V1', 'OK', ['a\nb', 'x'.repeat(1000), 42]);
    const p = await e.prisma.pasoJob.findFirstOrThrow({ where: { jobId: job.id, codigo: 'V1' } });
    expect(p.log).toEqual(['a b', 'x'.repeat(300)]);
  });
});

describe('jobs: cancelar y reintentar', () => {
  it('cancelado mientras corre: el siguiente reporte del agente recibe 409 detener', async () => {
    const { job } = await verificarEncolado();
    const ag = await crearAgente(e.prisma);
    await reclamar(ag.id);
    await e.jobs.cancelar(job.id, op, null);
    const r = await errorDe(e.jobs.reportarPaso(ag.id, job.id, 'V1', 'OK', []));
    expect(r.status).toBe(409);
    expect(r.cuerpo.detener).toBe(true);
    expect((await errorDe(e.jobs.cancelar(job.id, op, null))).status).toBe(422);
  });

  it('reintentar repite desde el paso fallido; los OK no se repiten', async () => {
    const { job } = await verificarEncolado();
    const ag = await crearAgente(e.prisma);
    await reclamar(ag.id);
    for (const c of ['V1', 'V2', 'V3', 'V4']) await correrPaso(ag.id, job.id, c);
    await correrPaso(ag.id, job.id, 'V5', 'FALLIDO');
    expect(await estadoJob(job.id)).toBe('FALLIDO');
    expect((await errorDe(e.jobs.reintentar(job.id + 99, op, null))).status).toBe(404);

    await e.jobs.reintentar(job.id, op, null);
    expect(await estadosPasos(job.id)).toEqual({ P0: 'OK', V1: 'OK', V2: 'OK', V3: 'OK', V4: 'OK', V5: 'PENDIENTE' });
    const r = await reclamar(ag.id);
    expect(r!.pasos.filter((p) => p.estado !== 'OK').map((p) => p.codigo)).toEqual(['V5']);
    await correrPaso(ag.id, job.id, 'V5');
    expect(await estadoJob(job.id)).toBe('OK');
    // V1 corrio una sola vez en todo el job.
    expect((await e.prisma.pasoJob.findFirstOrThrow({ where: { jobId: job.id, codigo: 'V1' } })).intentos).toBe(1);
  });

  it('solo se reintenta un job FALLIDO', async () => {
    const { job } = await verificarEncolado();
    expect((await errorDe(e.jobs.reintentar(job.id, op, null))).status).toBe(422);
  });

  it('reintentar con P0 fallido vuelve a correr P0 (y puede pasar si se corrigio la causa)', async () => {
    ventana.mockReturnValue(true);
    await crearSilo(e.prisma);
    const job = await e.jobs.crear('REINICIAR_SILO', { siloSlug: 'kibou' }, op, null);
    expect(job.estado).toBe('FALLIDO');
    ventana.mockReturnValue(false);
    const r = await e.jobs.reintentar(job.id, op, null);
    expect(r.estado).toBe('PENDIENTE');
    expect(await estadosPasos(job.id)).toMatchObject({ P0: 'OK', E1: 'PENDIENTE' });
  });
});

describe('jobs: carreras conocidas', () => {
  /** Encontrado 2026-11-14: antes el job se cerraba dos veces (job.ok x2). El cierre ahora exige estado EN_CURSO. */
  it('dos reportes finales simultaneos cierran el job una sola vez', async () => {
    const { job } = await verificarEncolado();
    const ag = await crearAgente(e.prisma);
    await reclamar(ag.id);
    for (const c of ['V1', 'V2', 'V3', 'V4']) await correrPaso(ag.id, job.id, c);
    await e.jobs.reportarPaso(ag.id, job.id, 'V5', 'EN_CURSO', []);
    await Promise.allSettled([e.jobs.reportarPaso(ag.id, job.id, 'V5', 'OK', []), e.jobs.reportarPaso(ag.id, job.id, 'V5', 'OK', [])]);
    expect(await contarAuditoria(e.prisma, 'job.ok')).toBe(1);
  });
});
