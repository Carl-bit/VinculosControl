/**
 * Job APROVISIONAR contra Postgres real: P0/P1 en el plano de control, orden de
 * los pasos, espera manual de llaves (P5), vuelta a P5 si P6 no encuentra la
 * KEK, espera del dominio (P8), datos de imagen de P2, cierre ACTIVO y
 * cancelacion (centro de vuelta a APROBADO, sin borrar nada).
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
  ventana = jest.spyOn(pasos, 'enVentanaRespaldo').mockReturnValue(false);
});
afterEach(() => ventana.mockRestore());

const CUSTODIOS = [
  { nombre: 'Ana Perez', rol: 'Proveedor' },
  { nombre: 'Luis Soto', rol: 'Centro' },
  { nombre: 'Sobre', rol: 'Sobre offline' },
];
const D_API = `sha256:${'a'.repeat(64)}`;
const D_WEB = `sha256:${'b'.repeat(64)}`;
const fija = (slug = 'kibou', version = '0.1.0') => ({ ...manifiestoValido(slug), version: { fija: version } });

async function encolar(contenido: unknown = fija()) {
  const c = await crearCentroAprobado(e.prisma, 'kibou', contenido);
  const job = await e.jobs.crear('APROVISIONAR', { centroId: c.id }, op, null);
  return { c, job };
}
const reclamar = (agenteId: number) => e.jobs.reclamar(agenteId, ['APROVISIONAR']);
const estadoJob = async (id: number) => (await e.prisma.job.findUniqueOrThrow({ where: { id } })).estado;
const estadoCentro = async (id: number) => (await e.prisma.centro.findUniqueOrThrow({ where: { id } })).estado;
const estadosPasos = async (id: number) =>
  Object.fromEntries((await e.prisma.pasoJob.findMany({ where: { jobId: id }, orderBy: { orden: 'asc' } })).map((p) => [p.codigo, p.estado]));

/** El agente corre un paso como lo hace de verdad (EN_CURSO y luego el final). */
async function paso(agenteId: number, jobId: number, codigo: string, extra: Parameters<Entorno['jobs']['reportarPaso']>[6] = {}, estado: 'OK' | 'FALLIDO' = 'OK', error?: string) {
  await e.jobs.reportarPaso(agenteId, jobId, codigo, 'EN_CURSO', []);
  return e.jobs.reportarPaso(agenteId, jobId, codigo, estado, [`${codigo} ${estado}`], error, extra);
}

describe('aprovisionar: P0 y P1 en el plano de control', () => {
  it('con version fija: P0 y P1 OK, centro APROVISIONANDO, silo registrado sin adoptar', async () => {
    const { c, job } = await encolar();
    expect(job.estado).toBe('PENDIENTE');
    expect(await estadosPasos(job.id)).toMatchObject({ P0: 'OK', P1: 'OK', P2: 'PENDIENTE', P5: 'PENDIENTE' });
    expect(await estadoCentro(c.id)).toBe('APROVISIONANDO');
    const silo = await e.prisma.silo.findUniqueOrThrow({ where: { slug: 'kibou' } });
    expect(silo).toMatchObject({ dominio: 'kibou.vinculos.cl', adoptado: false });
  });

  it('con canal: P0 falla (los canales llegan con releases) y el centro sigue APROBADO', async () => {
    const { c, job } = await encolar(manifiestoValido('kibou'));
    expect(job.estado).toBe('FALLIDO');
    expect(job.error).toMatch(/canal/);
    expect(await estadoCentro(c.id)).toBe('APROBADO');
  });

  it('nombre que el ejecutor no acepta, dominio de otro silo o stack ajeno ya reportado: P0 falla', async () => {
    const malo = { ...fija(), centro: { ...fija().centro, nombre: 'Centro "Kibou"' } };
    expect((await encolar(malo)).job.error).toMatch(/nombre/);
    await limpiar(e.prisma, e.correo);
    op = await sesionDeOperador(e.prisma);
    await e.prisma.silo.create({ data: { slug: 'otro', dominio: 'kibou.vinculos.cl' } });
    expect((await encolar()).job.error).toMatch(/dominio/);
    await limpiar(e.prisma, e.correo);
    op = await sesionDeOperador(e.prisma);
    await crearSilo(e.prisma, 'kibou');
    expect((await encolar()).job.error).toMatch(/ya reporta/);
  });

  it('P0 y P1 dos veces (reintento): una sola transicion y el mismo silo', async () => {
    const { c, job } = await encolar();
    const j = await e.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    const contenido = (await e.prisma.revisionManifiesto.findFirstOrThrow({ where: { centroId: c.id } })).contenido;
    expect((await e.aprovisionar.p0(j, contenido)).ok).toBe(true);
    expect((await e.aprovisionar.p1(j, contenido)).log).toContain('centro ya APROVISIONANDO');
    expect(await e.prisma.transicionCentro.count({ where: { centroId: c.id, hacia: 'APROVISIONANDO' } })).toBe(1);
    expect(await e.prisma.silo.count()).toBe(1);
  });

  it('solo desde APROBADO', async () => {
    const c = await crearCentroAprobado(e.prisma, 'kibou', fija());
    await e.prisma.centro.update({ where: { id: c.id }, data: { estado: 'ACTIVO' } });
    expect((await errorDe(e.jobs.crear('APROVISIONAR', { centroId: c.id }, op, null))).status).toBe(422);
  });
});

describe('aprovisionar: pasos del agente, esperas y cierre', () => {
  it('flujo completo: P2 (digests) -> P4 -> espera P5 -> llaves -> P6..P10 -> ACTIVO', async () => {
    const { c, job } = await encolar();
    const ag = await crearAgente(e.prisma);
    const r = await reclamar(ag.id);
    expect(r?.pasos.map((p) => p.codigo)).toEqual(['P2', 'P4', 'P6', 'P7', 'P8', 'P9', 'P10']);

    await paso(ag.id, job.id, 'P2', { datos: { version: '0.1.0', apiDigest: D_API, webDigest: D_WEB } });
    expect(await e.prisma.silo.findUniqueOrThrow({ where: { slug: 'kibou' } })).toMatchObject({ version: '0.1.0', apiDigest: D_API, webDigest: D_WEB });

    // P6 antes de P5 (manual): la API lo rechaza y pide detenerse.
    expect((await errorDe(e.jobs.reportarPaso(ag.id, job.id, 'P6', 'EN_CURSO', []))).status).toBe(409);

    // P4 OK: el siguiente es manual, el job espera las llaves y el agente se detiene.
    expect(await paso(ag.id, job.id, 'P4')).toEqual({ seguir: false });
    expect(await estadoJob(job.id)).toBe('ESPERANDO_LLAVES');
    expect(await reclamar(ag.id)).toBeNull();

    // P8 no se confirma en ESPERANDO_LLAVES; P5 exige los 3 custodios, sin ':' ni ',' (formato del script).
    expect((await errorDe(e.jobs.confirmar(job.id, 'P8', '', op, null))).status).toBe(409);
    expect((await errorDe(e.jobs.confirmar(job.id, 'P5', '', op, null))).status).toBe(422);
    expect((await errorDe(e.jobs.confirmar(job.id, 'P5', '', op, null, CUSTODIOS.slice(0, 2)))).status).toBe(422);
    expect((await errorDe(e.jobs.confirmar(job.id, 'P5', '', op, null, [{ nombre: 'Ana, Perez', rol: 'Proveedor' }, ...CUSTODIOS.slice(1)]))).status).toBe(422);
    await e.jobs.confirmar(job.id, 'P5', '', op, null, CUSTODIOS);
    expect(await estadoJob(job.id)).toBe('PENDIENTE');
    const p5 = await e.prisma.pasoJob.findFirstOrThrow({ where: { jobId: job.id, codigo: 'P5' } });
    expect(p5.estado).toBe('OK');
    expect(p5.log.slice(1)).toEqual(['parte 1: Ana Perez (Proveedor)', 'parte 2: Luis Soto (Centro)', 'parte 3: Sobre (Sobre offline)']);
    expect(await contarAuditoria(e.prisma, 'job.llaves_confirmadas')).toBe(1);

    // Retoma desde P6 (los pasos OK no se repiten).
    const r2 = await reclamar(ag.id);
    expect(r2?.pasos.filter((p) => p.estado !== 'OK').map((p) => p.codigo)).toEqual(['P6', 'P7', 'P8', 'P9', 'P10']);
    for (const cod of ['P6', 'P7', 'P8', 'P9']) await paso(ag.id, job.id, cod);
    expect(await estadoCentro(c.id)).toBe('APROVISIONANDO');
    await paso(ag.id, job.id, 'P10');

    expect(await estadoJob(job.id)).toBe('OK');
    expect(await estadoCentro(c.id)).toBe('ACTIVO');
    expect(await e.prisma.silo.findUniqueOrThrow({ where: { slug: 'kibou' } })).toMatchObject({ adoptado: true });
    expect(await contarAuditoria(e.prisma, 'centro.activo')).toBe(1);
    const t = await e.prisma.transicionCentro.findFirstOrThrow({ where: { centroId: c.id, hacia: 'ACTIVO' } });
    expect(t.motivo).toMatch(/0\.1\.0/);
  });

  it('P6 sin llaves: vuelve a ESPERANDO_LLAVES con P5 reabierto; P8 sin dominio: ESPERANDO_OPERADOR hasta confirmar', async () => {
    const { job } = await encolar();
    const ag = await crearAgente(e.prisma);
    await reclamar(ag.id);
    await paso(ag.id, job.id, 'P2', { datos: { version: '0.1.0', apiDigest: D_API, webDigest: D_WEB } });
    await paso(ag.id, job.id, 'P4');
    await e.jobs.confirmar(job.id, 'P5', '', op, null, CUSTODIOS);
    await reclamar(ag.id);

    // El operador confirmo pero la KEK no esta: el ejecutor responde 409 y el agente pide esperar.
    expect(await paso(ag.id, job.id, 'P6', { espera: 'LLAVES' }, 'FALLIDO', 'faltan las llaves de kibou (P5, ESPERANDO_LLAVES)')).toEqual({ seguir: false });
    expect(await estadoJob(job.id)).toBe('ESPERANDO_LLAVES');
    expect(await estadosPasos(job.id)).toMatchObject({ P5: 'PENDIENTE', P6: 'PENDIENTE' });

    await e.jobs.confirmar(job.id, 'P5', '', op, null, CUSTODIOS);
    await reclamar(ag.id);
    await paso(ag.id, job.id, 'P6');
    // Una espera en un paso que no la admite: 422. Un paso fuera de turno: 409 (orden).
    expect((await errorDe(paso(ag.id, job.id, 'P7', { espera: 'DOMINIO' }))).status).toBe(422);
    expect((await errorDe(paso(ag.id, job.id, 'P9'))).status).toBe(409);
    await paso(ag.id, job.id, 'P7');

    expect(await paso(ag.id, job.id, 'P8', { espera: 'DOMINIO' }, 'FALLIDO', 'El dominio aun no llega')).toEqual({ seguir: false });
    expect(await estadoJob(job.id)).toBe('ESPERANDO_OPERADOR');
    expect(await reclamar(ag.id)).toBeNull();

    await e.jobs.confirmar(job.id, 'P8', 'ruta creada en el tunel', op, null);
    expect(await estadoJob(job.id)).toBe('PENDIENTE');
    const r = await reclamar(ag.id);
    // P8 vuelve al agente: la confirmacion no reemplaza la verificacion.
    expect(r?.pasos.filter((p) => p.estado !== 'OK').map((p) => p.codigo)).toEqual(['P8', 'P9', 'P10']);
  });

  it('datos de imagen: solo en P2 y de la version del manifiesto', async () => {
    const { job } = await encolar();
    const ag = await crearAgente(e.prisma);
    await reclamar(ag.id);
    expect((await errorDe(paso(ag.id, job.id, 'P2', { datos: { version: '0.2.0', apiDigest: D_API, webDigest: D_WEB } }))).status).toBe(422);
    expect((await e.prisma.silo.findUniqueOrThrow({ where: { slug: 'kibou' } })).version).toBeNull();
  });

  it('cancelar: el centro vuelve a APROBADO y un job nuevo reutiliza el stack que quedo', async () => {
    const { c, job } = await encolar();
    const ag = await crearAgente(e.prisma);
    await reclamar(ag.id);
    await paso(ag.id, job.id, 'P2', { datos: { version: '0.1.0', apiDigest: D_API, webDigest: D_WEB } });
    await e.jobs.cancelar(job.id, op, null);
    expect(await estadoCentro(c.id)).toBe('APROBADO');
    // El agente ya reporta erp-kibou (quedo del job cancelado): el siguiente APROVISIONAR lo acepta.
    await e.prisma.silo.update({ where: { slug: 'kibou' }, data: { vistoEn: new Date() } });
    const otro = await e.jobs.crear('APROVISIONAR', { centroId: c.id }, op, null);
    expect(otro.estado).toBe('PENDIENTE');
    expect(await estadoCentro(c.id)).toBe('APROVISIONANDO');
  });

  it('renovar la reserva: solo el agente que tiene el job EN_CURSO', async () => {
    const { job } = await encolar();
    const ag = await crearAgente(e.prisma);
    const otro = await crearAgente(e.prisma, 'otro');
    await reclamar(ag.id);
    expect(await e.jobs.renovarReserva(ag.id, job.id)).toEqual({ seguir: true });
    expect(await e.jobs.renovarReserva(otro.id, job.id)).toEqual({ seguir: false });
  });
});
