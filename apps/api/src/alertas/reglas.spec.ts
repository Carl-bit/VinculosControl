import { evaluar, type Estado, type EstadoSilo } from './reglas';

const ahora = new Date('2026-11-08T12:00:00Z');
const ok = { ok: true, canarios: true, http: 200, error: null };
const sano: EstadoSilo = {
  slug: 'estres',
  salud: [ok, ok],
  contenedores: [{ servicio: 'backend', memBytes: 100 * 2 ** 20, memLimite: 256 * 2 ** 20, reinicios: 0, reiniciosPrevios: 0, oom: false, estado: 'running' }],
  latencias: [{ ruta: 'GET /api/salud', n: 100, p95: 12 }],
  respaldo: { fecha: new Date('2026-11-08T02:00:00Z') },
};
const base = (s: Partial<EstadoSilo> = {}, e: Partial<Estado> = {}): Estado => ({
  ahora,
  agente: { nombre: 'host-b', ultimoLatido: new Date(ahora.getTime() - 20_000) },
  host: { discoPct: 40 },
  silos: [{ ...sano, ...s }],
  ...e,
});
const claves = (e: Estado) =>
  evaluar(e)
    .map((a) => a.clave)
    .sort();

describe('evaluar', () => {
  it('silo sano y agente vivo: sin alertas', () => {
    expect(evaluar(base())).toEqual([]);
  });

  it('un sondeo fallido no alcanza; dos seguidos abren S1', () => {
    const falla = { ok: false, canarios: null, http: 502, error: null };
    expect(claves(base({ salud: [falla, ok] }))).toEqual([]);
    expect(evaluar(base({ salud: [falla, falla] }))[0]).toMatchObject({ clave: 'salud:estres', severidad: 'S1', mensaje: '/api/salud falla: HTTP 502' });
  });

  it('canarios en falso es S1 desde el primer sondeo', () => {
    expect(claves(base({ salud: [{ ok: false, canarios: false, http: 503, error: null }, ok] }))).toEqual(['canarios:estres']);
  });

  it('memoria sobre 90 %, reinicio, OOM y contenedor detenido', () => {
    const c = sano.contenedores[0]!;
    expect(claves(base({ contenedores: [{ ...c, memBytes: 240 * 2 ** 20 }] }))).toEqual(['memoria:estres/backend']);
    expect(claves(base({ contenedores: [{ ...c, reinicios: 1, reiniciosPrevios: 0 }] }))).toEqual(['reinicio:estres/backend']);
    expect(claves(base({ contenedores: [{ ...c, oom: true }] }))).toEqual(['reinicio:estres/backend']);
    expect(claves(base({ contenedores: [{ ...c, estado: 'exited' }] }))).toEqual(['contenedor:estres/backend']);
    // Primer reporte (sin previo): un contador alto no es un reinicio nuevo.
    expect(claves(base({ contenedores: [{ ...c, reinicios: 3, reiniciosPrevios: null }] }))).toEqual([]);
  });

  it('p95 lento solo con muestra suficiente', () => {
    expect(claves(base({ latencias: [{ ruta: 'GET /api/citas', n: 5, p95: 900 }] }))).toEqual([]);
    expect(claves(base({ latencias: [{ ruta: 'GET /api/citas', n: 50, p95: 900 }] }))).toEqual(['latencia:estres']);
  });

  it('respaldo viejo o inexistente es S3', () => {
    expect(claves(base({ respaldo: null }))).toEqual(['respaldo:estres']);
    expect(claves(base({ respaldo: { fecha: new Date('2026-11-07T02:00:00Z') } }))).toEqual(['respaldo:estres']);
  });

  it('agente sin latido por mas de 2 min y disco del host', () => {
    expect(claves(base({}, { agente: { nombre: 'host-b', ultimoLatido: new Date(ahora.getTime() - 180_000) } }))).toEqual(['agente:host-b']);
    expect(claves(base({}, { host: { discoPct: 91 } }))).toEqual(['host:disco']);
  });
});
