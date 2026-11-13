import {
  enmascararCorreo,
  esperaReenvio,
  evaluarCodigo,
  evaluarCredenciales,
  hashClave,
  hmacCodigo,
  igualesHex,
  ipValida,
  LIMITES,
  sesionVigente,
  verificarClave,
} from './reglas';

const ahora = new Date('2026-11-12T15:00:00Z');
const min = (m: number) => new Date(ahora.getTime() + m * 60_000);

describe('contrasenas', () => {
  it('verifica la correcta y rechaza otra', () => {
    const h = hashClave('una-clave-larga-de-prueba');
    expect(verificarClave('una-clave-larga-de-prueba', h)).toBe(true);
    expect(verificarClave('otra-clave', h)).toBe(false);
  });
  it('usa sal propia (dos hashes de la misma clave difieren)', () => {
    expect(hashClave('x'.repeat(12))).not.toBe(hashClave('x'.repeat(12)));
  });
  it('rechaza formatos desconocidos', () => {
    expect(verificarClave('x', 'bcrypt$abc')).toBe(false);
  });
});

describe('paso 1: credenciales', () => {
  const cuenta = { activo: true, fallos: 0, bloqueadaHasta: null };

  it('ok deja los fallos en 0', () => {
    expect(evaluarCredenciales({ ...cuenta, fallos: 3 }, true, ahora)).toEqual({ resultado: 'ok', fallos: 0, bloqueadaHasta: null });
  });

  it('suma fallos y bloquea 15 min al quinto', () => {
    let fallos = 0;
    for (let i = 1; i < LIMITES.fallos; i++) {
      const r = evaluarCredenciales({ ...cuenta, fallos }, false, ahora);
      expect(r.resultado).toBe('invalida');
      fallos = r.fallos;
    }
    expect(fallos).toBe(4);
    const r = evaluarCredenciales({ ...cuenta, fallos }, false, ahora);
    expect(r).toEqual({ resultado: 'bloqueo', fallos: 0, bloqueadaHasta: min(15) });
  });

  it('bloqueada no evalua la contrasena, ni siquiera la correcta', () => {
    const r = evaluarCredenciales({ ...cuenta, bloqueadaHasta: min(5) }, true, ahora);
    expect(r.resultado).toBe('bloqueada');
  });

  it('el bloqueo vencido ya no cuenta', () => {
    expect(evaluarCredenciales({ ...cuenta, bloqueadaHasta: min(-1) }, true, ahora).resultado).toBe('ok');
  });

  it('cuenta inexistente o inactiva = invalida, aunque la clave calce', () => {
    expect(evaluarCredenciales(null, true, ahora).resultado).toBe('invalida');
    expect(evaluarCredenciales({ ...cuenta, activo: false }, true, ahora).resultado).toBe('invalida');
  });
});

describe('paso 2: codigo', () => {
  const d = { venceEn: min(10), usadoEn: null, intentos: 0 };

  it('ok dentro del plazo', () => {
    expect(evaluarCodigo(d, true, ahora)).toBe('ok');
  });
  it('vencido a los 10 min', () => {
    expect(evaluarCodigo({ ...d, venceEn: ahora }, true, ahora)).toBe('vencido');
  });
  it('un solo uso', () => {
    expect(evaluarCodigo({ ...d, usadoEn: min(-1) }, true, ahora)).toBe('vencido');
  });
  it('inexistente = vencido', () => {
    expect(evaluarCodigo(null, true, ahora)).toBe('vencido');
  });
  it('el quinto fallo agota el desafio y despues ni el correcto sirve', () => {
    expect(evaluarCodigo({ ...d, intentos: 3 }, false, ahora)).toBe('invalido');
    expect(evaluarCodigo({ ...d, intentos: 4 }, false, ahora)).toBe('agotado');
    expect(evaluarCodigo({ ...d, intentos: 5 }, true, ahora)).toBe('agotado');
  });
  it('HMAC atado al desafio', () => {
    const a = hmacCodigo('secreto-de-prueba-largo', 'desafio-1', '123456');
    expect(igualesHex(a, hmacCodigo('secreto-de-prueba-largo', 'desafio-1', '123456'))).toBe(true);
    expect(igualesHex(a, hmacCodigo('secreto-de-prueba-largo', 'desafio-2', '123456'))).toBe(false);
    expect(igualesHex(a, '')).toBe(false);
  });
  it('reenvio: espera 45 s, maximo 3', () => {
    const base = { ...d, enviadoEn: ahora, reenvios: 0 };
    expect(esperaReenvio(base, ahora)).toBe(45);
    expect(esperaReenvio(base, new Date(ahora.getTime() + 45_000))).toBe(0);
    expect(esperaReenvio({ ...base, reenvios: 3 }, min(1))).toBeNull();
    expect(esperaReenvio({ ...base, venceEn: ahora }, ahora)).toBeNull();
  });
});

describe('sesion', () => {
  const s = { creadaEn: ahora, ultimaActividad: ahora, revocadaEn: null };
  it('vigente con actividad reciente', () => {
    expect(sesionVigente(s, min(29))).toBe(true);
  });
  it('expira con 30 min sin actividad', () => {
    expect(sesionVigente(s, min(30))).toBe(false);
  });
  it('expira a las 12 h aunque haya actividad', () => {
    expect(sesionVigente({ ...s, ultimaActividad: min(12 * 60 - 1) }, min(12 * 60))).toBe(false);
  });
  it('revocada no sirve', () => {
    expect(sesionVigente({ ...s, revocadaEn: ahora }, min(1))).toBe(false);
  });
});

describe('utilidades', () => {
  it('enmascara el correo', () => {
    expect(enmascararCorreo('charlie@vinculos.cl')).toBe('c••••••@vinculos.cl');
  });
  it('solo acepta IPs', () => {
    expect(ipValida('100.64.0.7')).toBe('100.64.0.7');
    expect(ipValida('::1')).toBe('::1');
    expect(ipValida('<script>')).toBeNull();
    expect(ipValida(undefined)).toBeNull();
  });
});
