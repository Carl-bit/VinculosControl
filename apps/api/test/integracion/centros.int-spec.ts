/**
 * Centros contra Postgres real: la solicitud de fase 1 y las transiciones
 * manuales del pipeline, cada una con su evento de auditoria.
 */
import { fase1Schema } from '@vinculos/manifest';
import { hashManifiesto } from '@vinculos/manifest/hash';

import type { OperadorSesion } from '../../src/acceso/acceso.service';
import { contarAuditoria, crearEntorno, type Entorno, errorDe, limpiar, sesionDeOperador } from './entorno';

let e: Entorno;
let op: OperadorSesion;

beforeAll(async () => {
  e = await crearEntorno();
});
afterAll(() => e.cerrar());
beforeEach(async () => {
  await limpiar(e.prisma, e.correo);
  op = await sesionDeOperador(e.prisma);
});

const fase1 = () =>
  fase1Schema.parse({
    nombre_centro: 'Centro Kibou',
    contacto: { nombre: 'Ana Perez', correo: 'ana@kibou.cl' },
    comuna: 'Providencia',
    tamano_equipo: '6 a 15',
    modulos_interes: ['AGENDA', 'FICHAS'],
    sitio_existente: 'nuevo',
    estilo_preferido: 'moderno',
  });

async function solicitud() {
  await e.centros.crearSolicitud(fase1());
  return e.prisma.centro.findFirstOrThrow({ include: { revisiones: true, transiciones: true } });
}

describe('centros: solicitud de fase 1', () => {
  it('crea el centro en SOLICITUD, la revision 1 con hash, la transicion y el evento; avisa a los operadores', async () => {
    const c = await solicitud();
    expect(c.estado).toBe('SOLICITUD');
    expect(c.slug).toBeNull();
    expect(c.revisiones).toHaveLength(1);
    expect(c.revisiones[0]).toMatchObject({ numero: 1, fase: 1, autor: 'centro:fase1' });
    expect(c.revisiones[0].hash).toBe(hashManifiesto(c.revisiones[0].contenido));
    expect(c.transiciones).toMatchObject([{ desde: null, hacia: 'SOLICITUD', actor: 'sitio' }]);
    expect(await contarAuditoria(e.prisma, 'centro.solicitud')).toBe(1);
    expect(e.correo.enviados).toEqual([{ para: op.correo, tipo: 'aviso' }]);
  });

  it('si el aviso por correo falla, la solicitud queda igual', async () => {
    e.correo.fallar = true;
    const c = await solicitud();
    expect(c.estado).toBe('SOLICITUD');
  });
});

describe('centros: transiciones manuales', () => {
  it('SOLICITUD -> CONTACTADO -> REUNION, cada una con transicion y evento', async () => {
    const c = await solicitud();
    await e.centros.transitar(c.id, 'CONTACTADO', undefined, op, '10.0.0.1');
    await e.centros.transitar(c.id, 'REUNION', undefined, op, null);
    const d = await e.centros.detalle(c.id);
    expect(d.estado).toBe('REUNION');
    expect(d.transiciones.map((t) => `${t.desde}->${t.hacia}`)).toEqual(['CONTACTADO->REUNION', 'SOLICITUD->CONTACTADO', 'null->SOLICITUD']);
    expect(await contarAuditoria(e.prisma, 'centro.transicion')).toBe(2);
  });

  it('una transicion fuera de la maquina o que no es manual se rechaza sin dejar rastro', async () => {
    const c = await solicitud();
    expect((await errorDe(e.centros.transitar(c.id, 'REUNION', undefined, op, null))).status).toBe(422);
    expect((await errorDe(e.centros.transitar(c.id, 'APROBADO', undefined, op, null))).status).toBe(422);
    expect((await errorDe(e.centros.transitar(c.id, 'ELIMINADO', undefined, op, null))).status).toBe(422);
    expect(await e.prisma.transicionCentro.count()).toBe(1);
    expect(await contarAuditoria(e.prisma, 'centro.transicion')).toBe(0);
  });

  it('descartar exige motivo y es final', async () => {
    const c = await solicitud();
    expect((await errorDe(e.centros.transitar(c.id, 'DESCARTADO', '  ', op, null))).status).toBe(422);
    await e.centros.transitar(c.id, 'DESCARTADO', 'sin presupuesto', op, null);
    expect((await e.prisma.transicionCentro.findFirstOrThrow({ where: { hacia: 'DESCARTADO' } })).motivo).toBe('sin presupuesto');
    expect((await errorDe(e.centros.transitar(c.id, 'CONTACTADO', undefined, op, null))).status).toBe(422);
  });

  it('DATOS_COMPLETOS a mano exige los datos del centro', async () => {
    const c = await solicitud();
    await e.centros.transitar(c.id, 'CONTACTADO', undefined, op, null);
    await e.centros.transitar(c.id, 'REUNION', undefined, op, null);
    expect((await errorDe(e.centros.transitar(c.id, 'DATOS_COMPLETOS', undefined, op, null))).status).toBe(422);
  });

  it('dos operadores mueven el mismo centro a la vez: uno gana, el otro recibe 409', async () => {
    const c = await solicitud();
    const r = await Promise.allSettled([
      e.centros.transitar(c.id, 'CONTACTADO', undefined, op, null),
      e.centros.transitar(c.id, 'DESCARTADO', 'duplicado', op, null),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await e.prisma.transicionCentro.count()).toBe(2);
  });

  it('centro inexistente: 404', async () => {
    expect((await errorDe(e.centros.transitar(999, 'CONTACTADO', undefined, op, null))).status).toBe(404);
  });
});
