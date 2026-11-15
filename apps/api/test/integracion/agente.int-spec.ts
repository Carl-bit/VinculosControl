/**
 * Reporte del agente (/agente/latido, /agente/reporte) contra Postgres real:
 * token, validacion del cuerpo (solo metadatos, nada fuera de la lista),
 * escritura del reporte y su efecto en las alertas.
 */
import { type ExecutionContext, UnauthorizedException, ValidationPipe } from '@nestjs/common';

import { AgenteController } from '../../src/agente/agente.controller';
import { AgenteGuard } from '../../src/agente/agente.guard';
import { LatidoDto, ReporteDto } from '../../src/agente/reporte.dto';
import { AlertasService } from '../../src/alertas/alertas.service';
import { crearAgente, crearEntorno, type Entorno, limpiar } from './entorno';

let e: Entorno;
let guard: AgenteGuard;
let agente: AgenteController;
let alertas: AlertasService;
/** El mismo pipe que main.ts: sin campos fuera del DTO. */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validar = <T>(tipo: new () => T, cuerpo: unknown) => pipe.transform(cuerpo, { type: 'body', metatype: tipo }) as Promise<T>;

const ctx = (authorization?: string) => {
  const req: { headers: Record<string, string>; agenteId?: number } = { headers: authorization ? { authorization } : {} };
  return { req, c: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext };
};

const ahora = () => new Date().toISOString();
const reporte = (o: { estado?: string; bytes?: number; slug?: string; sinRespaldo?: boolean } = {}) => ({
  host: { discoPct: 40, memUsada: 4 * 2 ** 30, memTotal: 16 * 2 ** 30, carga1: 0.5, cpus: 8 },
  silos: [
    {
      slug: o.slug ?? 'kibou',
      contenedores: [
        { servicio: 'db', cpuPct: 1, memBytes: 50 * 2 ** 20, memLimite: 256 * 2 ** 20, reinicios: 0, oom: false, estado: o.estado ?? 'running' },
        { servicio: 'backend', cpuPct: 2, memBytes: 90 * 2 ** 20, memLimite: 256 * 2 ** 20, reinicios: 0, oom: false, estado: 'running' },
      ],
      latencias: [{ ruta: 'GET /api/salud', n: 30, p50: 4, p95: 9, max: 20 }],
      ...(o.sinRespaldo ? {} : { respaldo: { archivo: `${o.slug ?? 'kibou'}-20261115T050000Z.dump.enc`, fecha: ahora(), bytes: o.bytes ?? 5_000_000, sha256: 'a'.repeat(64) } }),
    },
  ],
});

/** Lo que hace Nest con una peticion: guard + pipe + handler. */
async function enviar(cuerpo: unknown, token = `Bearer agente-host-b${'x'.repeat(32)}`) {
  const { req, c } = ctx(token);
  await guard.canActivate(c);
  await agente.reporte(req as never, await validar(ReporteDto, cuerpo));
}

beforeAll(async () => {
  e = await crearEntorno();
  guard = new AgenteGuard(e.prisma);
  agente = new AgenteController(e.prisma);
  alertas = new AlertasService(e.prisma);
});
afterAll(() => e.cerrar());
beforeEach(async () => {
  await limpiar(e.prisma, e.correo);
  // crearAgente guarda sha256("agente-<nombre>"); el guard exige 32+ caracteres: se usa un nombre largo.
  await crearAgente(e.prisma, `host-b${'x'.repeat(32)}`);
});

describe('token del agente', () => {
  it('sin token, corto o desconocido: 401; valido: deja el id del agente', async () => {
    for (const h of [undefined, 'Bearer corto', `Bearer ${'z'.repeat(40)}`, `Basic agente-host-b${'x'.repeat(32)}`]) {
      await expect(guard.canActivate(ctx(h).c)).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const { req, c } = ctx(`Bearer agente-host-b${'x'.repeat(32)}`);
    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(req.agenteId).toBeGreaterThan(0);
  });
});

describe('cuerpo del reporte: solo metadatos de la lista', () => {
  it('rechaza campos de mas, servicios ajenos, rutas con query y nombres de respaldo raros', async () => {
    const malos: unknown[] = [
      { ...reporte(), paciente: 'x' },
      { ...reporte(), silos: [{ ...reporte().silos[0], nota: 'texto libre' }] },
      { ...reporte(), silos: [{ ...reporte().silos[0], contenedores: [{ ...reporte().silos[0].contenedores[0], servicio: 'redis' }] }] },
      { ...reporte(), silos: [{ ...reporte().silos[0], latencias: [{ ruta: 'GET /api/pacientes?rut=1-9', n: 1, p50: 1, p95: 1, max: 1 }] }] },
      { ...reporte(), silos: [{ ...reporte().silos[0], respaldo: { archivo: '../../etc/passwd', fecha: ahora(), bytes: 1 } }] },
      { ...reporte(), silos: [{ ...reporte().silos[0], slug: 'Kibou Centro' }] },
    ];
    for (const m of malos) await expect(validar(ReporteDto, m)).rejects.toThrow();
    await expect(validar(LatidoDto, { version: '0.2.0', extra: 1 })).rejects.toThrow();
    await expect(validar(ReporteDto, reporte())).resolves.toBeInstanceOf(ReporteDto);
  });
});

describe('escritura del reporte', () => {
  it('descubre el silo sin adoptarlo, guarda metricas con una marca y actualiza el respaldo', async () => {
    await enviar(reporte());
    const silo = await e.prisma.silo.findUniqueOrThrow({ where: { slug: 'kibou' } });
    expect(silo.adoptado).toBe(false);
    const m = await e.prisma.metricaContenedor.findMany({ where: { slug: 'kibou' } });
    expect(m).toHaveLength(2);
    expect(new Set(m.map((x) => x.en.getTime())).size).toBe(1);
    expect(await e.prisma.latenciaRuta.count()).toBe(1);
    expect(await e.prisma.metricaHost.count()).toBe(1);
    expect((await e.prisma.agente.findFirstOrThrow()).ultimoLatido).not.toBeNull();

    await enviar(reporte({ bytes: 6_000_000 }));
    expect(await e.prisma.metricaContenedor.count()).toBe(4);
    expect(await e.prisma.silo.count()).toBe(1);
    expect(Number((await e.prisma.respaldo.findUniqueOrThrow({ where: { slug: 'kibou' } })).bytes)).toBe(6_000_000);
  });

  it('latido guarda la version', async () => {
    const { req, c } = ctx(`Bearer agente-host-b${'x'.repeat(32)}`);
    await guard.canActivate(c);
    await agente.latido(req as never, await validar(LatidoDto, { version: '0.3.0' }));
    expect((await e.prisma.agente.findFirstOrThrow()).version).toBe('0.3.0');
  });
});

describe('reporte -> alertas', () => {
  const abiertas = async () => (await e.prisma.alerta.findMany({ where: { cerradaEn: null }, orderBy: { clave: 'asc' } })).map((a) => `${a.severidad} ${a.clave}`);

  it('un silo sin adoptar no abre alertas aunque este caido', async () => {
    await enviar(reporte({ estado: 'exited', bytes: 32 }));
    await alertas.revisar();
    expect(await abiertas()).toEqual([]);
  });

  it('adoptado: contenedor detenido S1 y respaldo vacio S2; se cierran solas al normalizarse', async () => {
    await enviar(reporte());
    await e.prisma.silo.update({ where: { slug: 'kibou' }, data: { adoptado: true, adoptadoEn: new Date() } });
    await enviar(reporte({ estado: 'exited', bytes: 32 }));
    await alertas.revisar();
    expect(await abiertas()).toEqual(['S1 contenedor:kibou/db', 'S2 respaldo_vacio:kibou']);
    await alertas.revisar(); // no duplica
    expect(await e.prisma.alerta.count()).toBe(2);

    await enviar(reporte());
    await alertas.revisar();
    expect(await abiertas()).toEqual([]);
    expect(await e.prisma.alerta.count({ where: { cerradaEn: { not: null } } })).toBe(2);
  });

  it('soltar el silo cierra sus alertas abiertas', async () => {
    await enviar(reporte());
    await e.prisma.silo.update({ where: { slug: 'kibou' }, data: { adoptado: true } });
    await enviar(reporte({ sinRespaldo: true, estado: 'exited' }));
    await alertas.revisar();
    expect(await abiertas()).toContain('S1 contenedor:kibou/db');
    await e.prisma.silo.update({ where: { slug: 'kibou' }, data: { adoptado: false } });
    await alertas.revisar();
    expect(await abiertas()).toEqual([]);
  });
});
