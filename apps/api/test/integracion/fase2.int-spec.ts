/**
 * Fase 2 contra Postgres real: slug, enlace privado del centro, borrador
 * editable por ambas partes, envio del centro y aprobacion con P0.
 */
import type { OperadorSesion } from '../../src/acceso/acceso.service';
import { fase1Schema } from '@vinculos/manifest';
import { hashManifiesto } from '@vinculos/manifest/hash';

import { contarAuditoria, crearEntorno, crearSilo, type Entorno, errorDe, limpiar, sesionDeOperador } from './entorno';

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

const centroDatos = {
  nombre: 'Centro Kibou',
  razon_social: 'Kibou Psicologia SpA',
  rut: '76.086.428-5',
  tipo_entidad: 'spa',
  admin: { nombre: 'Ana Perez', correo: 'admin@kibou.cl' },
  responsable_datos: { nombre: 'Ana Perez', correo: 'direccion@kibou.cl' },
};

/** Centro en REUNION con slug, como queda tras la reunion. */
async function enReunion(slug = 'kibou') {
  await e.centros.crearSolicitud(
    fase1Schema.parse({
      nombre_centro: 'Centro Kibou',
      contacto: { nombre: 'Ana Perez', correo: 'ana@kibou.cl' },
      comuna: 'Providencia',
      tamano_equipo: '6 a 15',
      modulos_interes: ['AGENDA', 'FICHAS'],
      sitio_existente: 'nuevo',
      estilo_preferido: 'moderno',
    }),
  );
  const c = await e.prisma.centro.findFirstOrThrow();
  await e.centros.transitar(c.id, 'CONTACTADO', undefined, op, null);
  await e.centros.transitar(c.id, 'REUNION', undefined, op, null);
  await e.fase2.definirSlug(c.id, slug, op, null);
  return c.id;
}
const tokenDe = (url: string) => url.split('/manifiesto/')[1];

describe('fase 2: slug', () => {
  it('unico contra centros y silos, formato valido, inmutable desde APROBADO', async () => {
    await crearSilo(e.prisma, 'ocupado');
    const id = await enReunion();
    expect((await errorDe(e.fase2.definirSlug(id, 'ocupado', op, null))).status).toBe(409);
    expect((await errorDe(e.fase2.definirSlug(id, 'Con Espacios', op, null))).status).toBe(400);
    expect((await errorDe(e.fase2.definirSlug(id, 'demo-real', op, null))).status).toBe(400);
    await e.fase2.definirSlug(id, 'kibou', op, null); // mismo: sin cambios
    expect(await contarAuditoria(e.prisma, 'centro.slug')).toBe(1);
  });
});

describe('fase 2: enlace privado del centro', () => {
  it('solo desde REUNION con slug; rotar revoca el anterior; vencido o revocado es 410', async () => {
    const id = await enReunion();
    const a = await e.fase2.enviarEnlace(id, op, null);
    expect(e.correo.enviados.filter((x) => x.tipo === 'fase2')).toEqual([{ para: 'ana@kibou.cl', tipo: 'fase2' }]);
    // En la BD solo queda el sha256 del token.
    const fila = await e.prisma.enlaceFase2.findFirstOrThrow();
    expect(fila.tokenHash).not.toContain(tokenDe(a.url));
    await expect(e.fase2.abrir(tokenDe(a.url))).resolves.toMatchObject({ editable: true, subdominioSugerido: 'kibou.vinculos.cl' });

    const b = await e.fase2.enviarEnlace(id, op, null);
    expect((await errorDe(e.fase2.abrir(tokenDe(a.url)))).status).toBe(410);
    await expect(e.fase2.abrir(tokenDe(b.url))).resolves.toBeTruthy();
    expect(await e.prisma.enlaceFase2.count({ where: { revocadoEn: null } })).toBe(1);

    await e.prisma.enlaceFase2.updateMany({ where: { revocadoEn: null }, data: { venceEn: new Date(Date.now() - 1000) } });
    expect((await errorDe(e.fase2.abrir(tokenDe(b.url)))).status).toBe(410);
    expect((await errorDe(e.fase2.abrir('token-inventado'))).status).toBe(410);
  });

  it('si el correo falla no queda un enlace vivo', async () => {
    const id = await enReunion();
    e.correo.fallar = true;
    await expect(e.fase2.enviarEnlace(id, op, null)).rejects.toThrow('smtp caido');
    expect(await e.prisma.enlaceFase2.count()).toBe(0);
  });

  it('antes de la reunion no hay enlace', async () => {
    await e.centros.crearSolicitud(
      fase1Schema.parse({ nombre_centro: 'Otro', contacto: { nombre: 'X Y', correo: 'x@otro.cl' }, comuna: 'Nunoa', tamano_equipo: '1 a 5', modulos_interes: ['AGENDA'], sitio_existente: 'nuevo', estilo_preferido: 'moderno' }),
    );
    const c = await e.prisma.centro.findFirstOrThrow();
    expect((await errorDe(e.fase2.enviarEnlace(c.id, op, null))).status).toBe(422);
  });
});

describe('fase 2: borrador del centro, envio y aprobacion', () => {
  it('punta a punta: el centro completa y envia, el operador agrega contrato y aprueba; el enlace muere', async () => {
    const id = await enReunion();
    const t = tokenDe((await e.fase2.enviarEnlace(id, op, null)).url);

    // El centro no puede tocar lo que es del operador (contrato, version).
    expect((await errorDe(e.fase2.guardarPorCentro(t, { legal: { contrato_encargo: { version: 'x', firmado_en: '2026-11-01' } } }))).status).toBe(400);
    // Enviar incompleto: 422 con los campos que faltan; el estado no cambia.
    const falta = await errorDe(e.fase2.enviarPorCentro(t));
    expect(falta.status).toBe(422);
    expect((falta.cuerpo.campos as unknown[]).length).toBeGreaterThan(0);

    await e.fase2.guardarPorCentro(t, { centro: centroDatos, dominio: { tipo: 'subdominio', valor: 'kibou.vinculos.cl' } });
    await e.fase2.guardarPorCentro(t, { centro: centroDatos, dominio: { tipo: 'subdominio', valor: 'kibou.vinculos.cl' } }); // igual: sin revision nueva
    const revs = await e.prisma.revisionManifiesto.findMany({ where: { centroId: id }, orderBy: { numero: 'asc' } });
    expect(revs.map((r) => [r.numero, r.fase, r.autor])).toEqual([
      [1, 1, 'centro:fase1'],
      [2, 2, 'centro:enlace'],
    ]);
    expect(revs[1].hash).toBe(hashManifiesto(revs[1].contenido));

    await e.fase2.enviarPorCentro(t);
    await e.fase2.enviarPorCentro(t); // idempotente
    expect((await e.prisma.centro.findUniqueOrThrow({ where: { id } })).estado).toBe('DATOS_COMPLETOS');
    expect(await e.prisma.transicionCentro.count({ where: { centroId: id, hacia: 'DATOS_COMPLETOS' } })).toBe(1);

    // Sin contrato, P0 no deja aprobar.
    const sinContrato = await errorDe(e.fase2.aprobar(id, op, null));
    expect(sinContrato.status).toBe(422);
    expect(JSON.stringify(sinContrato.cuerpo.errores)).toContain('contrato');

    const { borrador } = await e.fase2.resumen(id, 'kibou', 'Centro Kibou');
    const g = await e.fase2.guardarPorOperador(id, { ...borrador, version: { canal: 'estable' }, legal: { contrato_encargo: { version: '2026-11', firmado_en: '2026-11-14' } } }, op, null);
    expect(g.p0.ok).toBe(true);

    const r = await e.fase2.aprobar(id, op, null);
    const c = await e.prisma.centro.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ estado: 'APROBADO', revisionAprobada: r.revision, hashAprobado: r.hash });
    const congelada = await e.prisma.revisionManifiesto.findFirstOrThrow({ where: { centroId: id, numero: r.revision } });
    expect(congelada.fase).toBe(3);
    expect(hashManifiesto(congelada.contenido)).toBe(r.hash);
    expect(await contarAuditoria(e.prisma, 'centro.aprobado')).toBe(1);

    // Tras aprobar: enlace revocado, nada se edita, el slug no cambia y no se aprueba dos veces.
    expect((await errorDe(e.fase2.abrir(t))).status).toBe(410);
    expect((await errorDe(e.fase2.guardarPorOperador(id, borrador, op, null))).status).toBe(422);
    expect((await errorDe(e.fase2.definirSlug(id, 'kibou-dos', op, null))).status).toBe(422);
    expect((await errorDe(e.fase2.aprobar(id, op, null))).status).toBe(422);
  });

  it('dos aprobaciones a la vez: una gana, la otra no deja rastro', async () => {
    const id = await enReunion();
    const t = tokenDe((await e.fase2.enviarEnlace(id, op, null)).url);
    await e.fase2.guardarPorCentro(t, { centro: centroDatos, dominio: { tipo: 'subdominio', valor: 'kibou.vinculos.cl' } });
    await e.fase2.enviarPorCentro(t);
    const { borrador } = await e.fase2.resumen(id, 'kibou', 'Centro Kibou');
    await e.fase2.guardarPorOperador(id, { ...borrador, version: { canal: 'estable' }, legal: { contrato_encargo: { version: '2026-11', firmado_en: '2026-11-14' } } }, op, null);

    const r = await Promise.allSettled([e.fase2.aprobar(id, op, null), e.fase2.aprobar(id, op, null)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await e.prisma.revisionManifiesto.count({ where: { centroId: id, fase: 3 } })).toBe(1);
    expect(await e.prisma.transicionCentro.count({ where: { centroId: id, hacia: 'APROBADO' } })).toBe(1);
  });
});
