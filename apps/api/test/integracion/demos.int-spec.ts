/**
 * Demos a medida (R10) contra Postgres real: el operador crea un demo con las
 * cantidades que quiere mostrar (centro origen demo, manifiesto aprobado con el
 * bloque demo y APROVISIONAR encolado) y lo resiembra (REINICIAR_DEMO).
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
const pedido = { slug: 'demo-kibou', nombre: 'Centro Kibou Demo', canal: 'demo', tema: 'moderno', modulos: ['FICHAS', 'AGENDA', 'EQUIPO'], cuentasMadre: 2, profesionales: 5, pacientes: 60 };

describe('demos', () => {
  it('crear: centro origen demo con manifiesto aprobado (bloque demo, datos ficticios) y APROVISIONAR encolado', async () => {
    const ag = await crearAgente(e.prisma);
    await e.releases.registrar(ag.id, [{ version: '0.1.0', apiDigest: d('1'), webDigest: d('2'), commit: 'abcdef1', publicada: '2026-11-15T15:00:00Z' }]);
    await e.releases.promover('0.1.0', 'demo', op, null);
    const r = await e.demos.crear(pedido as never, op, null);
    const c = await e.prisma.centro.findUniqueOrThrow({ where: { id: r.centroId } });
    expect([c.origen, c.estado, c.slug]).toEqual(['demo', 'APROVISIONANDO', 'demo-kibou']);
    const rev = await e.prisma.revisionManifiesto.findUniqueOrThrow({ where: { centroId_numero: { centroId: c.id, numero: c.revisionAprobada! } } });
    expect(rev.contenido).toMatchObject({ demo: { cuentas_madre: 2, profesionales: 5, pacientes: 60 }, centro: { rut: '11111111-1' }, dominio: { valor: 'demo-kibou.vinculos.cl' } });
    expect(r.job.tipo).toBe('APROVISIONAR');
    expect(r.job.pasos.find((p) => p.codigo === 'P0')?.estado).toBe('OK');
    expect(await contarAuditoria(e.prisma, 'demo.creado')).toBe(1);
    expect((await errorDe(e.demos.crear(pedido as never, op, null))).status).toBe(409);
    expect((await errorDe(e.demos.crear({ ...pedido, slug: 'demo-otro', fija: '0.1.0' } as never, op, null))).status).toBe(422);
    // Prefijo demo- reservado: un demo sin el prefijo no se crea.
    expect((await errorDe(e.demos.crear({ ...pedido, slug: 'kibou-prueba' } as never, op, null))).status).toBe(422);
    const lista = await e.demos.listar();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ slug: 'demo-kibou', cantidades: { cuentas_madre: 2, profesionales: 5, pacientes: 60 }, aprovisionar: { estado: 'PENDIENTE' } });
  });

  it('REINICIAR_DEMO: solo un demo activo y reportado, uno por hora; un centro real no se resiembra', async () => {
    const ag = await crearAgente(e.prisma);
    const demo = await crearCentroAprobado(e.prisma, 'demo-kibou', { ...manifiestoValido('demo-kibou'), demo: { cuentas_madre: 1, profesionales: 2, pacientes: 10 } });
    const real = await crearCentroAprobado(e.prisma, 'kibou', manifiestoValido('kibou'));
    for (const c of [demo, real]) await e.prisma.centro.update({ where: { id: c.id }, data: { estado: 'ACTIVO' } });
    for (const slug of ['demo-kibou', 'kibou']) await e.prisma.silo.create({ data: { slug, adoptado: true, vistoEn: new Date() } });

    expect((await e.jobs.crear('REINICIAR_DEMO', { siloSlug: 'kibou' }, op, null)).error).toMatch(/no es de demostracion/);
    const job = await e.jobs.crear('REINICIAR_DEMO', { siloSlug: 'demo-kibou' }, op, null);
    expect(job.estado).toBe('PENDIENTE');
    const r = await e.jobs.reclamar(ag.id, ['REINICIAR_DEMO']);
    expect(r?.pasos.map((p) => p.codigo)).toEqual(['R1']);
    await e.jobs.reportarPaso(ag.id, job.id, 'R1', 'EN_CURSO', []);
    await e.jobs.reportarPaso(ag.id, job.id, 'R1', 'OK', ['Demo demo-kibou: 3 hora(s) agendada(s)']);
    expect((await e.jobs.crear('REINICIAR_DEMO', { siloSlug: 'demo-kibou' }, op, null)).error).toMatch(/menos de una hora/);
  });
  it('vence a las 24 h; extender suma 24 h; un demo sin preparar pasa directo a ELIMINADO y suelta su slug', async () => {
    const ag = await crearAgente(e.prisma);
    await e.releases.registrar(ag.id, [{ version: '0.1.0', apiDigest: d('1'), webDigest: d('2'), commit: 'abcdef1', publicada: '2026-11-15T15:00:00Z' }]);
    await e.releases.promover('0.1.0', 'demo', op, null);
    const antes = Date.now();
    const r = await e.demos.crear(pedido as never, op, null);
    const c = await e.prisma.centro.findUniqueOrThrow({ where: { id: r.centroId } });
    expect(c.demoVenceEn!.getTime() - antes).toBeGreaterThanOrEqual(24 * 3600_000 - 5_000);

    const ext = await e.demos.extender(c.id, op, null);
    expect(ext.venceEn.getTime() - c.demoVenceEn!.getTime()).toBe(24 * 3600_000);
    expect(await contarAuditoria(e.prisma, 'demo.extendido')).toBe(1);

    // Aun no vence: vencer no hace nada.
    await e.demos.vencer();
    expect((await e.prisma.centro.findUniqueOrThrow({ where: { id: c.id } })).estado).toBe('APROVISIONANDO');

    // Vencido con APROVISIONAR PENDIENTE (P2 sin correr): el job corre, bloquea.
    await e.prisma.centro.update({ where: { id: c.id }, data: { demoVenceEn: new Date(Date.now() - 1000) } });
    expect((await errorDe(e.demos.darDeBaja(c.id, 'control', null, 'prueba'))).status).toBe(409);
    // Esperando llaves: se cancela y, sin P2, pasa directo a ELIMINADO.
    await e.prisma.job.update({ where: { id: r.job.id }, data: { estado: 'ESPERANDO_LLAVES' } });
    await e.demos.vencer();
    const fin = await e.prisma.centro.findUniqueOrThrow({ where: { id: c.id } });
    expect(fin.estado).toBe('ELIMINADO');
    expect((await e.prisma.job.findUniqueOrThrow({ where: { id: r.job.id } })).estado).toBe('CANCELADO');
    expect(await e.prisma.job.count({ where: { tipo: 'ELIMINAR_DEMO' } })).toBe(0);
    expect((await errorDe(e.demos.extender(c.id, op, null))).status).toBe(422);

    // El slug queda libre para otro demo.
    const otro = await e.demos.crear(pedido as never, op, null);
    expect((await e.prisma.centro.findUniqueOrThrow({ where: { id: c.id } })).slug).toBeNull();
    expect((await e.prisma.centro.findUniqueOrThrow({ where: { id: otro.centroId } })).slug).toBe('demo-kibou');
  });

  it('ELIMINAR_DEMO: un demo preparado se baja por el agente (Y1, Y2); queda ELIMINADO y sin registro de silo', async () => {
    const ag = await crearAgente(e.prisma);
    const demo = await crearCentroAprobado(e.prisma, 'demo-kibou', { ...manifiestoValido('demo-kibou'), demo: { cuentas_madre: 1, profesionales: 2, pacientes: 10 } });
    const real = await crearCentroAprobado(e.prisma, 'kibou', manifiestoValido('kibou'));
    await e.prisma.centro.update({ where: { id: demo.id }, data: { estado: 'ACTIVO', origen: 'demo', demoVenceEn: new Date(Date.now() - 1000) } });
    await e.prisma.silo.create({ data: { slug: 'demo-kibou', adoptado: true, vistoEn: new Date() } });
    // APROVISIONAR que si llego a P2.
    await e.prisma.job.create({ data: { tipo: 'APROVISIONAR', centroId: demo.id, siloSlug: 'demo-kibou', estado: 'OK', creadoPor: 'x', pasos: { create: [{ orden: 0, codigo: 'P2', nombre: 'Preparar', detalle: '', ejecutor: 'agente', estado: 'OK' }] } } });

    // Un centro real nunca: ni por la baja ni desde la lista de jobs.
    expect((await errorDe(e.demos.darDeBaja(real.id, 'control', null, 'x'))).status).toBe(404);
    expect((await errorDe(e.jobs.crear('ELIMINAR_DEMO', { centroId: real.id }, op, null))).status).toBe(422);

    await e.demos.vencer();
    const job = await e.prisma.job.findFirstOrThrow({ where: { tipo: 'ELIMINAR_DEMO' } });
    expect(job.estado).toBe('PENDIENTE');
    // Idempotente: otra vuelta no encola otra baja.
    await e.demos.vencer();
    expect(await e.prisma.job.count({ where: { tipo: 'ELIMINAR_DEMO' } })).toBe(1);
    expect((await errorDe(e.demos.extender(demo.id, op, null))).status).toBe(409);

    const rec = await e.jobs.reclamar(ag.id, ['ELIMINAR_DEMO']);
    expect(rec?.pasos.map((p) => p.codigo)).toEqual(['Y1', 'Y2']);
    await e.jobs.reportarPaso(ag.id, job.id, 'Y1', 'OK', ['3 contenedor(es) borrado(s)']);
    await e.jobs.reportarPaso(ag.id, job.id, 'Y2', 'OK', ['erp-demo-kibou sin contenedores']);
    expect((await e.prisma.centro.findUniqueOrThrow({ where: { id: demo.id } })).estado).toBe('ELIMINADO');
    expect(await e.prisma.silo.findUnique({ where: { slug: 'demo-kibou' } })).toBeNull();
    expect(await contarAuditoria(e.prisma, 'demo.eliminado')).toBe(1);
    expect((await e.prisma.centro.findUniqueOrThrow({ where: { id: real.id } })).estado).toBe('APROBADO');
  });
});
