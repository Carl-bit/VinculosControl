/**
 * Protocolo de salida contra Postgres real: S1 iniciar -> S3-S5 acta de
 * recepcion -> S6 silo detenido (job DETENER_SILO o a mano) + confirmacion ->
 * S7 job ELIMINAR + acta de eliminacion; y la reversion (baja por error o
 * arrepentimiento) en cada etapa. Cada paso con transicion, auditoria e
 * idempotencia. El agente se simula reportando los pasos del job.
 */
import type { OperadorSesion } from '../../src/acceso/acceso.service';
import * as pasos from '../../src/jobs/pasos';
import type { Recepcion } from '../../src/salidas/salidas.service';
import { contarAuditoria, crearAgente, crearCentroAprobado, crearEntorno, crearSilo, type Entorno, errorDe, limpiar, sesionDeOperador } from './entorno';

let e: Entorno;
let op: OperadorSesion;
let centroId: number;
let ventana: jest.SpyInstance;

const DIA = 86_400_000;
const hace = (ms: number) => new Date(Date.now() - ms);
const HUELLA = 'ab'.repeat(32);

beforeAll(async () => {
  e = await crearEntorno();
});
afterAll(() => e.cerrar());
beforeEach(async () => {
  await limpiar(e.prisma, e.correo);
  ventana = jest.spyOn(pasos, 'enVentanaRespaldo').mockReturnValue(false);
  op = await sesionDeOperador(e.prisma);
  await crearSilo(e.prisma);
  await e.prisma.silo.update({ where: { slug: 'kibou' }, data: { adoptado: true, adoptadoEn: new Date(), dominio: 'kibou.vinculos.cl' } });
  const c = await crearCentroAprobado(e.prisma);
  await e.prisma.centro.update({ where: { id: c.id }, data: { estado: 'ACTIVO' } });
  centroId = c.id;
});
afterEach(() => ventana.mockRestore());

const inicio = (extra: Partial<{ fechaCorte: string; motivo: string; confirmacion: string }> = {}) => ({
  centroId,
  fechaCorte: '2026-12-31',
  motivo: 'Termino de contrato',
  confirmacion: 'kibou',
  ...extra,
});
const recepcion = (extra: Partial<Recepcion> = {}): Recepcion => ({
  exporteEn: hace(2 * 3600_000).toISOString(),
  exporteBytes: 52_428_800,
  exporteHuella: HUELLA,
  firmadaEn: hace(3600_000).toISOString(),
  recibeNombre: 'Ana Perez',
  recibeCargo: 'Directora',
  conteoPacientes: 120,
  conteoFichas: 118,
  huellaActa: HUELLA.toUpperCase(),
  ...extra,
});
const checklist = { detenido: true, volumenes: true, respaldosHost: true, respaldosBucket: true, llaves: true, custodios: true, dominio: true, crontab: true };
const manuales = { ...checklist, detenido: false, volumenes: false, respaldosHost: false };
const estado = async () => (await e.prisma.centro.findUniqueOrThrow({ where: { id: centroId } })).estado;
const solicitudCentro = (extra: Record<string, string> = {}) => ({
  solicitudEn: new Date().toISOString(),
  medio: 'CORREO' as const,
  referencia: 'Correo de direccion: seguimos con Vinculos',
  motivo: 'El centro renovo el contrato',
  confirmacion: 'kibou',
  ...extra,
});

/** El agente corre los pasos del job como si el ejecutor respondiera bien (o falla `falla`). */
async function correrJob(jobId: number, falla?: string) {
  const ag = (await e.prisma.agente.findFirst()) ?? (await crearAgente(e.prisma));
  const r = await e.jobs.reclamar(ag.id, ['DETENER_SILO', 'REANUDAR_SILO', 'ELIMINAR']);
  expect(r?.id).toBe(jobId);
  for (const p of r!.pasos) {
    await e.jobs.reportarPaso(ag.id, jobId, p.codigo, 'EN_CURSO', []);
    const mal = p.codigo === falla;
    await e.jobs.reportarPaso(ag.id, jobId, p.codigo, mal ? 'FALLIDO' : 'OK', [`${p.codigo} ${mal ? 'FALLIDO' : 'OK'}`, ...(p.codigo === 'X2' ? ['volumenes: erp-kibou_db_data, erp-kibou_exportaciones'] : [])], mal ? 'fallo simulado' : undefined);
    if (mal) return;
  }
  return r;
}
const ultimoJob = async (tipo: 'DETENER_SILO' | 'REANUDAR_SILO' | 'ELIMINAR') => e.prisma.job.findFirstOrThrow({ where: { tipo }, orderBy: { id: 'desc' } });

async function hastaExportado() {
  const s = await e.salidas.iniciar(inicio(), op, null);
  await e.salidas.registrarRecepcion(s.id, recepcion(), op, null);
  return s.id;
}

/** Lleva la salida hasta GRACIA (por el job DETENER_SILO) con la gracia ya vencida y la confirmacion registrada. */
async function hastaGraciaVencida() {
  const s = await e.salidas.iniciar(inicio(), op, null);
  await e.prisma.salida.update({ where: { id: s.id }, data: { iniciadaEn: hace(40 * DIA) } });
  await e.salidas.registrarRecepcion(s.id, recepcion({ exporteEn: hace(35 * DIA).toISOString(), firmadaEn: hace(31 * DIA).toISOString() }), op, null);
  await e.salidas.detener(s.id, op, null);
  await correrJob((await ultimoJob('DETENER_SILO')).id);
  await e.salidas.confirmar(s.id, { en: hace(DIA).toISOString(), medio: 'CORREO', referencia: 'Correo de direccion del 2026-12-20' }, op, null);
  return s.id;
}

describe('salidas: S1 iniciar', () => {
  it('ACTIVO -> EN_SALIDA con transicion y auditoria; repetir con los mismos datos no duplica', async () => {
    const d = await e.salidas.iniciar(inicio(), op, '10.0.0.1');
    expect([d.estado, d.desde, d.expediente]).toEqual(['EN_SALIDA', 'ACTIVO', 'abierta']);
    expect(d.pasos.find((p) => p.codigo === 'S5')?.estado).toBe('actual');
    expect((await e.salidas.iniciar(inicio(), op, null)).id).toBe(d.id);
    expect(await e.prisma.salida.count()).toBe(1);
    expect(await contarAuditoria(e.prisma, 'salida.iniciada')).toBe(1);
    expect((await errorDe(e.salidas.iniciar(inicio({ motivo: 'Otro motivo' }), op, null))).status).toBe(409);
  });

  it('exige escribir el slug y un estado de origen valido', async () => {
    expect((await errorDe(e.salidas.iniciar(inicio({ confirmacion: 'otro' }), op, null))).status).toBe(422);
    await e.prisma.centro.update({ where: { id: centroId }, data: { estado: 'APROBADO' } });
    expect((await errorDe(e.salidas.iniciar(inicio(), op, null))).status).toBe(422);
    expect(await e.prisma.salida.count()).toBe(0);
  });

  it('la base no admite dos salidas abiertas del mismo centro', async () => {
    const s = await e.salidas.iniciar(inicio(), op, null);
    await expect(e.prisma.salida.create({ data: { centroId, siloSlug: 'kibou', fechaCorte: new Date(), motivo: 'x', desde: 'ACTIVO', iniciadaPor: 'x' } })).rejects.toThrow();
    expect(s.expediente).toBe('abierta');
  });
});

describe('salidas: S3-S5 acta de recepcion', () => {
  let id: number;
  beforeEach(async () => {
    id = (await e.salidas.iniciar(inicio(), op, null)).id;
  });

  it('registra exporte y acta, calcula la gracia (30 dias desde la firma) y pasa a EXPORTADO; idempotente', async () => {
    const r = recepcion();
    const d = await e.salidas.registrarRecepcion(id, r, op, null);
    expect(d.estado).toBe('EXPORTADO');
    expect(d.exporteBytes).toBe(52_428_800);
    expect(d.actaRecepcionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(d.graciaHasta!).getTime()).toBe(new Date(r.firmadaEn).getTime() + 30 * DIA);
    await e.salidas.registrarRecepcion(id, r, op, null);
    expect(await contarAuditoria(e.prisma, 'salida.acta_recepcion')).toBe(1);
    expect((await errorDe(e.salidas.registrarRecepcion(id, { ...r, conteoFichas: 1 }, op, null))).status).toBe(409);
  });

  it('huella del acta distinta a la del exporte: 422 y el centro sigue EN_SALIDA', async () => {
    const r = await errorDe(e.salidas.registrarRecepcion(id, recepcion({ huellaActa: 'cd'.repeat(32) }), op, null));
    expect(r.status).toBe(422);
    expect(String(r.cuerpo.mensaje)).toMatch(/no coincide/);
    expect(await estado()).toBe('EN_SALIDA');
  });
});

describe('salidas: S6 detener (opcion B)', () => {
  it('por el ejecutor: job DETENER_SILO; al terminar OK pasa a GRACIA y sale del monitoreo', async () => {
    const id = await hastaExportado();
    await e.salidas.detener(id, op, null);
    expect(await estado()).toBe('EXPORTADO');
    const job = await ultimoJob('DETENER_SILO');
    expect(job.estado).toBe('PENDIENTE');
    await correrJob(job.id);
    const d = await e.salidas.detalle(id);
    expect([d.estado, d.detencionJobId]).toEqual(['GRACIA', job.id]);
    expect((await e.prisma.silo.findUniqueOrThrow({ where: { slug: 'kibou' } })).adoptado).toBe(false);
    // Repetir no encola otro job.
    await e.salidas.detener(id, op, null);
    expect(await e.prisma.job.count({ where: { tipo: 'DETENER_SILO' } })).toBe(1);
  });

  it('si el job falla, el centro sigue EXPORTADO', async () => {
    const id = await hastaExportado();
    await e.salidas.detener(id, op, null);
    await correrJob((await ultimoJob('DETENER_SILO')).id, 'D2');
    expect(await estado()).toBe('EXPORTADO');
    expect((await e.salidas.detalle(id)).siloDetenidoEn).toBeNull();
  });

  it('los jobs de una salida no se encolan desde la vista de jobs', async () => {
    expect((await errorDe(e.jobs.crear('DETENER_SILO', { centroId }, op, null))).status).toBe(422);
  });

  it('a mano: con contenedores en marcha reportados hace menos de 5 min, 409', async () => {
    const id = await hastaExportado();
    await e.prisma.metricaContenedor.create({ data: { slug: 'kibou', servicio: 'backend', cpuPct: 1, memBytes: 1n, memLimite: 1n, reinicios: 0, oom: false, estado: 'running' } });
    expect((await errorDe(e.salidas.siloDetenido(id, op))).status).toBe(409);
    await e.prisma.metricaContenedor.updateMany({ data: { en: hace(10 * 60_000) } });
    expect((await e.salidas.siloDetenido(id, op)).estado).toBe('GRACIA');
  });
});

describe('salidas: S7 eliminar (opcion C)', () => {
  it('antes de vencer la gracia o sin confirmacion no se encola ELIMINAR', async () => {
    const id = await hastaGraciaVencida();
    await e.prisma.salida.update({ where: { id }, data: { graciaHasta: new Date(Date.now() + DIA) } });
    expect(String((await errorDe(e.salidas.eliminarSilo(id, { confirmacion: 'kibou' }, op, null))).cuerpo.mensaje)).toMatch(/gracia vence/);
    await e.prisma.salida.update({ where: { id }, data: { graciaHasta: hace(DIA), confirmacionEn: null } });
    expect(String((await errorDe(e.salidas.eliminarSilo(id, { confirmacion: 'kibou' }, op, null))).cuerpo.mensaje)).toMatch(/confirmacion escrita/);
    expect(await e.prisma.job.count({ where: { tipo: 'ELIMINAR' } })).toBe(0);
  });

  it('job ELIMINAR con el hash del acta; al terminar, el acta S7 toma sus items y su log como evidencia', async () => {
    const id = await hastaGraciaVencida();
    expect((await errorDe(e.salidas.eliminarSilo(id, { confirmacion: 'kibu' }, op, null))).status).toBe(422);
    await e.salidas.eliminarSilo(id, { confirmacion: 'kibou' }, op, null);
    const job = await ultimoJob('ELIMINAR');
    const salida = await e.prisma.salida.findUniqueOrThrow({ where: { id } });
    expect(job.referencia).toBe(salida.actaRecepcionHash);
    const reclamado = await correrJob(job.id);
    expect(reclamado?.referencia).toBe(salida.actaRecepcionHash);

    let d = await e.salidas.detalle(id);
    expect(d.eliminacionJobId).toBe(job.id);
    expect(d.porJob).toEqual(['detenido', 'volumenes', 'respaldosHost']);
    expect(d.puedeRevertir).toBe(false);
    // El operador marca solo los items manuales.
    d = await e.salidas.eliminar(id, { checklist: manuales, confirmacion: 'kibou' }, op, null);
    expect(d.estado).toBe('ELIMINADO');
    const acta = d.actaEliminacion as { items: Record<string, string>; evidencia: string[] };
    expect(acta.items.volumenes).toBe(`job:${job.id}`);
    expect(acta.items.llaves).toBe('operador');
    expect(acta.evidencia.join(' ')).toMatch(/erp-kibou_db_data/);
    expect(e.correo.enviados.filter((x) => x.tipo === 'acta')).toEqual([{ para: 'direccion@kibou.cl', tipo: 'acta', hash: d.actaEliminacionHash }]);
  });

  it('sin job (a mano): el checklist completo lo marca el operador', async () => {
    const id = await hastaGraciaVencida();
    expect((await errorDe(e.salidas.eliminar(id, { checklist: manuales, confirmacion: 'kibou' }, op, null))).status).toBe(422);
    const d = await e.salidas.eliminar(id, { checklist, confirmacion: 'kibou' }, op, null);
    expect(d.estado).toBe('ELIMINADO');
    expect(d.pasos.every((p) => p.estado === 'hecho')).toBe(true);
    expect((await e.prisma.transicionCentro.findMany({ where: { centroId }, orderBy: { id: 'asc' } })).map((t) => t.hacia)).toEqual(['EN_SALIDA', 'EXPORTADO', 'GRACIA', 'ELIMINADO']);
  });

  it('si el correo falla, la eliminacion queda igual y el acta se reenvia', async () => {
    const id = await hastaGraciaVencida();
    e.correo.fallar = true;
    const d = await e.salidas.eliminar(id, { checklist, confirmacion: 'kibou' }, op, null);
    expect(d.estado).toBe('ELIMINADO');
    expect(d.envios).toMatchObject([{ ok: false, tipo: 'eliminacion' }]);
    e.correo.fallar = false;
    expect(await e.salidas.enviarActa(id, 'eliminacion', op)).toEqual({ enviada: true, para: 'direccion@kibou.cl' });
  });
});

describe('salidas: reversion (baja por error o arrepentimiento)', () => {
  it('desde EN_SALIDA vuelve al estado previo en el acto, con acta y copia por correo', async () => {
    await e.prisma.centro.update({ where: { id: centroId }, data: { estado: 'SUSPENDIDO' } });
    const s = await e.salidas.iniciar(inicio(), op, null);
    const d = await e.salidas.revertir(s.id, solicitudCentro(), op, null);
    expect([d.expediente, d.estado]).toEqual(['revertida', 'SUSPENDIDO']);
    expect(d.actaReversionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(e.correo.enviados.filter((x) => x.tipo === 'acta_reversion')).toHaveLength(1);
    // Idempotente y, cerrada, la salida ya no avanza.
    await e.salidas.revertir(s.id, solicitudCentro(), op, null);
    expect(await contarAuditoria(e.prisma, 'salida.revertida')).toBe(1);
    expect((await errorDe(e.salidas.registrarRecepcion(s.id, recepcion(), op, null))).status).toBe(422);
  });

  it('despues de revertir se puede iniciar otra salida (la anterior queda como historial)', async () => {
    const s = await e.salidas.iniciar(inicio(), op, null);
    await e.salidas.revertir(s.id, solicitudCentro(), op, null);
    const otra = await e.salidas.iniciar(inicio({ motivo: 'Nuevo termino' }), op, null);
    expect(otra.id).not.toBe(s.id);
    expect((await e.salidas.listar()).map((x) => x.expediente)).toEqual(['abierta', 'revertida']);
  });

  it('desde GRACIA con el silo detenido: job REANUDAR_SILO; al terminar OK vuelve a ACTIVO y al monitoreo', async () => {
    const id = await hastaExportado();
    await e.salidas.detener(id, op, null);
    await correrJob((await ultimoJob('DETENER_SILO')).id);
    let d = await e.salidas.revertir(id, solicitudCentro(), op, null);
    expect([d.expediente, d.estado]).toEqual(['reversion_pendiente', 'GRACIA']);
    // Mientras tanto la salida no avanza ni se elimina.
    expect((await errorDe(e.salidas.eliminarSilo(id, { confirmacion: 'kibou' }, op, null))).status).toBe(422);
    const job = await ultimoJob('REANUDAR_SILO');
    expect(d.reversionJobId).toBe(job.id);
    await correrJob(job.id);
    d = await e.salidas.detalle(id);
    expect([d.expediente, d.estado]).toEqual(['revertida', 'ACTIVO']);
    expect((await e.prisma.silo.findUniqueOrThrow({ where: { slug: 'kibou' } })).adoptado).toBe(true);
    expect((d.actaReversion as { siloReanudado: string }).siloReanudado).toBe(`job:${job.id}`);
  });

  it('si REANUDAR_SILO falla, la reversion queda pendiente; sin ejecutor se confirma a mano con el silo en marcha', async () => {
    const id = await hastaExportado();
    await e.salidas.siloDetenido(id, op);
    await e.salidas.revertir(id, solicitudCentro(), op, null);
    await correrJob((await ultimoJob('REANUDAR_SILO')).id, 'A1');
    expect((await e.salidas.detalle(id)).expediente).toBe('reversion_pendiente');
    expect((await errorDe(e.salidas.confirmarReanudado(id, op))).status).toBe(409);
    await e.prisma.metricaContenedor.create({ data: { slug: 'kibou', servicio: 'db', cpuPct: 1, memBytes: 1n, memLimite: 1n, reinicios: 0, oom: false, estado: 'running' } });
    expect((await e.salidas.confirmarReanudado(id, op)).expediente).toBe('revertida');
  });

  it('no se revierte despues de que ELIMINAR empezo a borrar', async () => {
    const id = await hastaGraciaVencida();
    await e.salidas.eliminarSilo(id, { confirmacion: 'kibou' }, op, null);
    await correrJob((await ultimoJob('ELIMINAR')).id, 'X2');
    expect(String((await errorDe(e.salidas.revertir(id, solicitudCentro(), op, null))).cuerpo.mensaje)).toMatch(/ya empezo a borrar/);
  });

  it('exige solicitud posterior al inicio, no futura, y el slug escrito', async () => {
    const s = await e.salidas.iniciar(inicio(), op, null);
    expect((await errorDe(e.salidas.revertir(s.id, solicitudCentro({ solicitudEn: hace(DIA).toISOString() }), op, null))).status).toBe(422);
    expect((await errorDe(e.salidas.revertir(s.id, solicitudCentro({ confirmacion: 'x' }), op, null))).status).toBe(422);
    expect(await estado()).toBe('EN_SALIDA');
  });
});
