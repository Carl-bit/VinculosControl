/**
 * Login de la consola contra Postgres real: credenciales -> codigo por correo
 * -> sesion. Los plazos se prueban moviendo fechas en la BD, sin esperar.
 */
import { CLAVE, contarAuditoria, crearEntorno, crearOperador, type Entorno, errorDe, limpiar } from './entorno';

const MIN = 60_000;
const hace = (ms: number) => new Date(Date.now() - ms);

let e: Entorno;
beforeAll(async () => {
  e = await crearEntorno();
});
afterAll(() => e.cerrar());
beforeEach(() => limpiar(e.prisma, e.correo));

async function entrar(correo = 'ops@vinculos.cl') {
  const { desafio } = await e.acceso.credenciales(correo, CLAVE, '10.0.0.1');
  return e.acceso.verificar(desafio, e.correo.ultimoCodigo(), '10.0.0.1');
}

describe('acceso: flujo completo', () => {
  it('credenciales -> codigo -> sesion valida -> salir', async () => {
    await crearOperador(e.prisma);
    const paso1 = await e.acceso.credenciales('  OPS@vinculos.cl ', CLAVE, '10.0.0.1');
    expect(paso1.correo).toBe('o••••••@vinculos.cl');
    expect(e.correo.enviados).toHaveLength(1);

    // El codigo se guarda solo como HMAC: nunca en claro.
    const fila = await e.prisma.codigoAcceso.findUniqueOrThrow({ where: { id: paso1.desafio } });
    expect(fila.codigoHmac).not.toContain(e.correo.ultimoCodigo());

    const s = await e.acceso.verificar(paso1.desafio, e.correo.ultimoCodigo(), '10.0.0.1');
    expect(s.token).toBeTruthy();
    const op = await e.acceso.validarSesion(s.token);
    expect(op?.correo).toBe('ops@vinculos.cl');
    // El token no se guarda en claro.
    expect(await e.prisma.sesion.count({ where: { tokenHash: s.token } })).toBe(0);

    await e.acceso.salir(op!, null);
    expect(await e.acceso.validarSesion(s.token)).toBeNull();
    for (const a of ['auth.codigo_enviado', 'auth.sesion_iniciada', 'auth.salida']) expect(await contarAuditoria(e.prisma, a)).toBe(1);
  });

  it('si el correo falla, el desafio no queda vivo', async () => {
    await crearOperador(e.prisma);
    e.correo.fallar = true;
    await expect(e.acceso.credenciales('ops@vinculos.cl', CLAVE, null)).rejects.toThrow();
    expect(await e.prisma.codigoAcceso.count()).toBe(0);
  });
});

describe('acceso: paso 1 (credenciales)', () => {
  it('5 contrasenas malas bloquean 15 min; con la cuenta bloqueada ni la correcta entra', async () => {
    await crearOperador(e.prisma);
    for (let i = 0; i < 4; i++) expect((await errorDe(e.acceso.credenciales('ops@vinculos.cl', 'mala', null))).status).toBe(401);
    const quinta = await errorDe(e.acceso.credenciales('ops@vinculos.cl', 'mala', null));
    expect(quinta.status).toBe(423);
    expect((await errorDe(e.acceso.credenciales('ops@vinculos.cl', CLAVE, null))).status).toBe(423);
    expect(e.correo.enviados).toHaveLength(0);
    expect(await contarAuditoria(e.prisma, 'auth.bloqueo')).toBe(1);

    // Vencido el bloqueo, la correcta entra y los fallos vuelven a 0.
    await e.prisma.operador.update({ where: { correo: 'ops@vinculos.cl' }, data: { bloqueadaHasta: hace(1000) } });
    await e.acceso.credenciales('ops@vinculos.cl', CLAVE, null);
    expect((await e.prisma.operador.findUniqueOrThrow({ where: { correo: 'ops@vinculos.cl' } })).fallos).toBe(0);
  });

  it('un correo que no existe responde igual que una contrasena mala', async () => {
    await crearOperador(e.prisma);
    const noExiste = await errorDe(e.acceso.credenciales('nadie@vinculos.cl', CLAVE, null));
    const mala = await errorDe(e.acceso.credenciales('ops@vinculos.cl', 'mala', null));
    expect(noExiste).toEqual(mala);
  });

  it('pedir credenciales de nuevo anula el desafio anterior', async () => {
    await crearOperador(e.prisma);
    const a = await e.acceso.credenciales('ops@vinculos.cl', CLAVE, null);
    const codigoA = e.correo.ultimoCodigo();
    await e.acceso.credenciales('ops@vinculos.cl', CLAVE, null);
    const r = await errorDe(e.acceso.verificar(a.desafio, codigoA, null));
    expect(r.status).toBe(401);
    expect(r.cuerpo.volver).toBe(true);
  });
});

describe('acceso: paso 2 (codigo)', () => {
  it('el codigo sirve una sola vez, aunque lleguen dos peticiones juntas', async () => {
    await crearOperador(e.prisma);
    const { desafio } = await e.acceso.credenciales('ops@vinculos.cl', CLAVE, null);
    const codigo = e.correo.ultimoCodigo();
    const r = await Promise.allSettled([e.acceso.verificar(desafio, codigo, null), e.acceso.verificar(desafio, codigo, null)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await e.prisma.sesion.count()).toBe(1);
    expect((await errorDe(e.acceso.verificar(desafio, codigo, null))).status).toBe(401);
  });

  it('vence a los 10 minutos', async () => {
    await crearOperador(e.prisma);
    const { desafio } = await e.acceso.credenciales('ops@vinculos.cl', CLAVE, null);
    await e.prisma.codigoAcceso.update({ where: { id: desafio }, data: { venceEn: hace(1000) } });
    const r = await errorDe(e.acceso.verificar(desafio, e.correo.ultimoCodigo(), null));
    expect(r.status).toBe(401);
    expect(r.cuerpo.volver).toBe(true);
  });

  it('5 codigos malos agotan el desafio: despues ni el correcto sirve', async () => {
    await crearOperador(e.prisma);
    const { desafio } = await e.acceso.credenciales('ops@vinculos.cl', CLAVE, null);
    const bueno = e.correo.ultimoCodigo();
    const malo = bueno === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) expect((await errorDe(e.acceso.verificar(desafio, malo, null))).cuerpo.restantes).toBe(4 - i);
    expect((await errorDe(e.acceso.verificar(desafio, malo, null))).cuerpo.volver).toBe(true);
    expect((await errorDe(e.acceso.verificar(desafio, bueno, null))).status).toBe(401);
    expect(await e.prisma.sesion.count()).toBe(0);
  });

  it('reenvio: espera 45 s, invalida el codigo anterior y permite 3 como maximo', async () => {
    await crearOperador(e.prisma);
    const { desafio } = await e.acceso.credenciales('ops@vinculos.cl', CLAVE, null);
    const primero = e.correo.ultimoCodigo();
    expect((await errorDe(e.acceso.reenviar(desafio, null))).status).toBe(429);

    for (let i = 0; i < 3; i++) {
      await e.prisma.codigoAcceso.update({ where: { id: desafio }, data: { enviadoEn: hace(46_000) } });
      await e.acceso.reenviar(desafio, null);
    }
    await e.prisma.codigoAcceso.update({ where: { id: desafio }, data: { enviadoEn: hace(46_000) } });
    expect((await errorDe(e.acceso.reenviar(desafio, null))).cuerpo.volver).toBe(true);
    expect(e.correo.enviados).toHaveLength(4);

    const ultimo = e.correo.ultimoCodigo();
    if (primero !== ultimo) expect((await errorDe(e.acceso.verificar(desafio, primero, null))).status).toBe(401);
    expect((await e.acceso.verificar(desafio, ultimo, null)).token).toBeTruthy();
  });
});

describe('acceso: sesion', () => {
  it('vence con 30 min sin actividad', async () => {
    await crearOperador(e.prisma);
    const { token } = await entrar();
    await e.prisma.sesion.updateMany({ data: { ultimaActividad: hace(30 * MIN + 1000) } });
    expect(await e.acceso.validarSesion(token)).toBeNull();
  });

  it('vence a las 12 h aunque tenga actividad', async () => {
    await crearOperador(e.prisma);
    const { token } = await entrar();
    await e.prisma.sesion.updateMany({ data: { creadaEn: hace(12 * 60 * MIN + 1000), ultimaActividad: new Date() } });
    expect(await e.acceso.validarSesion(token)).toBeNull();
  });

  it('un operador desactivado pierde la sesion', async () => {
    await crearOperador(e.prisma);
    const { token } = await entrar();
    await e.prisma.operador.updateMany({ data: { activo: false } });
    expect(await e.acceso.validarSesion(token)).toBeNull();
  });

  it('la actividad se renueva como mucho una vez por minuto', async () => {
    await crearOperador(e.prisma);
    const { token } = await entrar();
    const antes = hace(5 * MIN);
    await e.prisma.sesion.updateMany({ data: { ultimaActividad: antes } });
    await e.acceso.validarSesion(token);
    const s = await e.prisma.sesion.findFirstOrThrow();
    expect(s.ultimaActividad.getTime()).toBeGreaterThan(antes.getTime());
  });
});
