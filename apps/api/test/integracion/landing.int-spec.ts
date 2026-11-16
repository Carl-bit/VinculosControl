/**
 * Canal de la landing publica (/landing/*) contra Postgres real: secreto
 * propio, solicitudes de fase 1 (origen "landing" o "enlace" del operador),
 * campo trampa, limite por IP, y el enlace privado de fase 2 por este canal.
 */
import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { fase1Schema } from '@vinculos/manifest';

import type { OperadorSesion } from '../../src/acceso/acceso.service';
import { LandingController, LandingGuard } from '../../src/publico/landing.controller';
import { CAMPO_TRAMPA } from '../../src/publico/solicitud';
import { contarAuditoria, crearEntorno, type Entorno, errorDe, limpiar, sesionDeOperador } from './entorno';

let e: Entorno;
let c: LandingController;
const SECRETO = 'secreto-de-la-landing-123456';

const ctx = (headers: Record<string, string>) => ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;
const solicitud = (o: Record<string, unknown> = {}) => ({
  nombre_centro: 'Centro Landing',
  contacto: { nombre: 'Ana Perez', correo: 'ana@landing.cl' },
  comuna: 'Providencia',
  tamano_equipo: '6 a 15',
  modulos_interes: ['AGENDA', 'EQUIPO', 'MATCH'],
  sitio_existente: 'nuevo',
  estilo_preferido: 'cuaderno',
  ...o,
});

beforeAll(async () => {
  process.env.LANDING_SECRETO = SECRETO;
  e = await crearEntorno();
});
afterAll(() => e.cerrar());
beforeEach(async () => {
  await limpiar(e.prisma, e.correo);
  c = new LandingController(e.centros, e.fase2);
});

describe('landing: secreto propio', () => {
  it('solo su secreto abre /landing', () => {
    const g = new LandingGuard();
    expect(g.canActivate(ctx({ 'x-landing-secreto': SECRETO }))).toBe(true);
    for (const h of <Record<string, string>[]>[{}, { 'x-sitio-secreto': SECRETO }, { 'x-landing-secreto': `${SECRETO}x` }, { 'x-landing-secreto': SECRETO.slice(1) }]) {
      expect(() => g.canActivate(ctx(h))).toThrow(ForbiddenException);
    }
  });

  it('sin LANDING_SECRETO configurado (o corto) la ruta queda cerrada', () => {
    process.env.LANDING_SECRETO = 'corto';
    expect(() => new LandingGuard().canActivate(ctx({ 'x-landing-secreto': 'corto' }))).toThrow(ForbiddenException);
    process.env.LANDING_SECRETO = SECRETO;
  });
});

describe('landing: solicitud de fase 1', () => {
  it('crea el centro con origen landing, revision 1, auditoria y aviso al operador', async () => {
    await e.prisma.operador.create({ data: { correo: 'ops@vinculos.cl', nombre: 'Ops', claveHash: 'x' } });
    await expect(c.solicitud(solicitud(), '10.0.0.1')).resolves.toEqual({ recibida: true });
    const centro = await e.prisma.centro.findFirstOrThrow({ include: { revisiones: true } });
    expect(centro).toMatchObject({ estado: 'SOLICITUD', origen: 'landing', nombre: 'Centro Landing' });
    expect(centro.revisiones).toHaveLength(1);
    expect(await contarAuditoria(e.prisma, 'centro.solicitud')).toBe(1);
    expect(e.correo.enviados).toEqual([{ para: 'ops@vinculos.cl', tipo: 'aviso' }]);
  });

  it('el enlace compartido desde la consola llega como "enlace"; cualquier otro origen, como "landing"', async () => {
    await c.solicitud(solicitud({ origen: 'enlace', nombre_centro: 'Por enlace' }), '10.0.0.4');
    await c.solicitud(solicitud({ origen: 'consola', nombre_centro: 'Inventado' }), '10.0.0.4');
    const filas = await e.prisma.centro.findMany({ orderBy: { id: 'asc' }, select: { nombre: true, origen: true } });
    expect(filas).toEqual([
      { nombre: 'Por enlace', origen: 'enlace' },
      { nombre: 'Inventado', origen: 'landing' },
    ]);
  });

  it('campo trampa lleno: responde igual y no guarda', async () => {
    await expect(c.solicitud(solicitud({ [CAMPO_TRAMPA]: 'http://spam' }), '10.0.0.2')).resolves.toEqual({ recibida: true });
    expect(await e.prisma.centro.count()).toBe(0);
  });

  it('modulos fuera del MVP o campos de mas: 400 sin rastro', async () => {
    expect((await errorDe(c.solicitud(solicitud({ modulos_interes: ['WHATSAPP'] }), '10.0.0.3'))).status).toBe(400);
    expect((await errorDe(c.solicitud(solicitud({ paciente: 'x' }), '10.0.0.3'))).status).toBe(400);
    expect(await e.prisma.centro.count()).toBe(0);
  });

  it('5 por hora por IP', async () => {
    for (let i = 0; i < 5; i++) await c.solicitud(solicitud({ nombre_centro: `Centro ${i}` }), '10.0.0.9');
    expect((await errorDe(c.solicitud(solicitud(), '10.0.0.9'))).status).toBe(429);
    await expect(c.solicitud(solicitud(), '10.0.0.10')).resolves.toEqual({ recibida: true });
  });
});

describe('landing: enlace privado de fase 2', () => {
  let op: OperadorSesion;

  async function enlace() {
    op = await sesionDeOperador(e.prisma);
    await e.centros.crearSolicitud(fase1Schema.parse(solicitud()));
    const centro = await e.prisma.centro.findFirstOrThrow();
    await e.centros.transitar(centro.id, 'CONTACTADO', undefined, op, null);
    await e.centros.transitar(centro.id, 'REUNION', undefined, op, null);
    await e.fase2.definirSlug(centro.id, 'landing', op, null);
    const { url } = await e.fase2.enviarEnlace(centro.id, op, null);
    return { id: centro.id, url, token: url.split('/manifiesto/')[1] };
  }

  it('el enlace que llega por correo apunta a la landing y funciona por este canal', async () => {
    const { id, url, token } = await enlace();
    expect(url.startsWith(`${(process.env.LANDING_URL ?? 'http://127.0.0.1:3300').replace(/\/$/, '')}/manifiesto/`)).toBe(true);
    await expect(c.abrir(token, '10.0.1.1')).resolves.toMatchObject({ editable: true, nombre: 'Centro Landing' });
    await c.guardar(
      token,
      {
        centro: { nombre: 'Centro Landing', razon_social: 'Landing SpA', rut: '76.086.428-5', tipo_entidad: 'spa', admin: { nombre: 'Ana Perez', correo: 'admin@landing.cl' }, responsable_datos: { nombre: 'Ana Perez', correo: 'datos@landing.cl' } },
        dominio: { tipo: 'subdominio', valor: 'landing.vinculos.cl' },
      },
      '10.0.1.1',
    );
    await expect(c.enviar(token, '10.0.1.1')).resolves.toEqual({ enviado: true });
    expect((await e.prisma.centro.findUniqueOrThrow({ where: { id } })).estado).toBe('DATOS_COMPLETOS');
  });

  it('token con forma invalida: 404; token inexistente: 410; 120 intentos por hora por IP', async () => {
    expect((await errorDe(Promise.resolve().then(() => c.abrir('corto', '10.0.2.1')))).status).toBe(404);
    expect((await errorDe(Promise.resolve().then(() => c.abrir('a'.repeat(43), '10.0.2.1')))).status).toBe(410);
    for (let i = 0; i < 118; i++) await errorDe(Promise.resolve().then(() => c.abrir('corto', '10.0.2.1')));
    expect((await errorDe(Promise.resolve().then(() => c.abrir('a'.repeat(43), '10.0.2.1')))).status).toBe(429);
  });
});
