/**
 * Incidentes y soporte contra Postgres real: hitos en orden, una sola vez,
 * plazos con dias habiles y feriados, y autorizaciones de soporte con vencimiento.
 */
import type { OperadorSesion } from '../../src/acceso/acceso.service';
import { AuditoriaService } from '../../src/auditoria/auditoria.service';
import { OperacionService } from '../../src/incidentes/operacion.service';
import { contarAuditoria, crearEntorno, type Entorno, errorDe, limpiar, sesionDeOperador } from './entorno';

let e: Entorno;
let op: OperadorSesion;
let ops: OperacionService;

beforeAll(async () => {
  e = await crearEntorno();
  ops = new OperacionService(e.prisma, new AuditoriaService(e.prisma));
});
afterAll(() => e.cerrar());
beforeEach(async () => {
  await limpiar(e.prisma, e.correo);
  op = await sesionDeOperador(e.prisma);
});

const hito = (d: { hitos: { clave: string; venceEn: Date | null }[] }, clave: string) => d.hitos.find((h) => h.clave === clave);

describe('incidentes', () => {
  it('S1 de punta a punta: contencion, aviso, actualizacion, informe y cierre, cada uno auditado', async () => {
    const i = await ops.crearIncidente({ severidad: 'S1', titulo: 'API del silo sin responder', siloSlug: 'kibou' }, op);
    expect(i.semaforo).not.toBe('cerrado');
    expect(i.eventos.map((x) => x.tipo)).toEqual(['apertura']);

    expect((await errorDe(ops.registrar(i.id, 'actualizacion', 'x', op))).status).toBe(422); // antes del aviso
    expect((await errorDe(ops.registrar(i.id, 'informe_final', 'x', op))).status).toBe(422); // antes de contener
    expect((await errorDe(ops.registrar(i.id, 'cierre', 'x', op))).status).toBe(422); // sin informe

    await ops.registrar(i.id, 'contencion', 'Reinicio del backend', op);
    expect((await errorDe(ops.registrar(i.id, 'contencion', 'otra vez', op))).status).toBe(422);
    await ops.registrar(i.id, 'aviso_centro', 'Aviso por correo al ADMIN', op);
    await ops.registrar(i.id, 'actualizacion', 'Sin novedad', op);
    await ops.registrar(i.id, 'informe_final', 'Causa: OOM del backend', op);
    const cerrado = await ops.registrar(i.id, 'cierre', 'Cerrado', op);
    expect(cerrado.semaforo).toBe('cerrado');
    expect(cerrado.eventos.map((x) => x.tipo)).toEqual(['apertura', 'contencion', 'aviso_centro', 'actualizacion', 'informe_final', 'cierre']);
    expect((await errorDe(ops.registrar(i.id, 'nota', 'tarde', op))).status).toBe(422);
    expect(await contarAuditoria(e.prisma, 'incidente.contencion')).toBe(1);
    expect(await ops.contarIncidentesAbiertos()).toBe(0);
  });

  it('dos registros del mismo hito a la vez: uno gana, el otro no deja evento', async () => {
    const i = await ops.crearIncidente({ severidad: 'S2', titulo: 'Disco del host alto' }, op);
    const r = await Promise.allSettled([ops.registrar(i.id, 'contencion', 'a', op), ops.registrar(i.id, 'contencion', 'b', op)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await e.prisma.eventoIncidente.count({ where: { incidenteId: i.id, tipo: 'contencion' } })).toBe(1);
    expect(await contarAuditoria(e.prisma, 'incidente.contencion')).toBe(1);
  });

  it('fecha de deteccion futura: 422; centro enlazado por slug', async () => {
    expect((await errorDe(ops.crearIncidente({ severidad: 'S3', titulo: 'x', detectadoEn: new Date(Date.now() + 3_600_000).toISOString() }, op))).status).toBe(422);
    const c = await e.prisma.centro.create({ data: { slug: 'kibou', nombre: 'K', contactoNombre: 'A', contactoCorreo: 'a@k.cl', comuna: 'X', origen: 'consola' } });
    const i = await ops.crearIncidente({ severidad: 'S3', titulo: 'Latencia alta', siloSlug: 'kibou' }, op);
    expect(i.centroId).toBe(c.id);
  });

  it('S3: el plazo de contencion en dias habiles salta el feriado del 8 de diciembre', async () => {
    const lunes = new Date('2026-12-07T13:00:00Z'); // lunes 10:00 Chile; martes 8 es feriado
    const i = await e.prisma.incidente.create({ data: { severidad: 'S3', titulo: 'x', detectadoEn: lunes, creadoPor: op.correo } });
    const d = await ops.detalleIncidente(i.id);
    expect(hito(d, 'contencion')?.venceEn?.toISOString()).toBe('2026-12-10T13:00:00.000Z'); // 2 habiles: miercoles 9 y jueves 10
  });
});

describe('soporte', () => {
  const pedido = (o: Partial<{ autorizadaEn: string; horas: number }> = {}) => ({
    siloSlug: 'kibou',
    motivo: 'Diagnostico de lentitud',
    alcance: 'diagnostico',
    autorizadaEn: o.autorizadaEn ?? new Date(Date.now() - 60_000).toISOString(),
    horas: o.horas ?? 4,
  });

  it('autorizacion vigente: abre con vencimiento; vencida o futura: 422', async () => {
    const s = await ops.crearSoporte(pedido(), op);
    expect(s.venceEn.getTime()).toBeGreaterThan(Date.now());
    expect((await errorDe(ops.crearSoporte(pedido({ autorizadaEn: new Date(Date.now() - 5 * 3_600_000).toISOString(), horas: 1 }), op))).status).toBe(422);
    expect((await errorDe(ops.crearSoporte(pedido({ autorizadaEn: new Date(Date.now() + 60_000).toISOString() }), op))).status).toBe(422);
  });

  it('se cierra una vez con su resultado; dos cierres a la vez dejan uno', async () => {
    const s = await ops.crearSoporte(pedido(), op);
    const r = await Promise.allSettled([ops.cerrarSoporte(s.id, 'Sin hallazgos', op), ops.cerrarSoporte(s.id, 'Otro', op)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await contarAuditoria(e.prisma, 'soporte.cerrado')).toBe(1);
    const fila = (await ops.listarSoporte())[0];
    expect(fila.estado).toBe('CERRADA');
  });
});
