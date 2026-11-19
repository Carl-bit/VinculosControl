import { cifrarClave, cuentasValidas, descifrarClave } from './acceso';

describe('acceso de los demos', () => {
  const secreto = 'x'.repeat(32);

  it('cifra y descifra la contrasena; otro secreto no la abre', () => {
    const g = cifrarClave(secreto, 'abcDEF123ghiJKL456');
    expect(g).not.toContain('abcDEF');
    expect(descifrarClave(secreto, g)).toBe('abcDEF123ghiJKL456');
    expect(cifrarClave(secreto, 'abcDEF123ghiJKL456')).not.toBe(g);
    expect(() => descifrarClave('y'.repeat(32), g)).toThrow();
  });

  it('solo correos del dominio ficticio del demo', () => {
    const cuentas = [
      { rol: 'ADMIN', email: 'direccion1@demo-kibou.demo.vinculos.cl' },
      { rol: 'PROFESIONAL', email: 'profesional2@demo-kibou.demo.vinculos.cl' },
      { rol: 'PACIENTE', email: 'persona@gmail.com' },
      { rol: 'PACIENTE', email: 'paciente1@demo-otro.demo.vinculos.cl' },
      { rol: 'x; drop', email: 'a@demo-kibou.demo.vinculos.cl' },
    ];
    expect(cuentasValidas('demo-kibou', cuentas)).toEqual(cuentas.slice(0, 2));
  });
});
