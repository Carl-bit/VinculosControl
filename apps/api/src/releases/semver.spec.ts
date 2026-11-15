import { bloqueoPromocion, compararVersion, esPrueba, tipoSalto } from './semver';

describe('versiones (seccion 7)', () => {
  it('orden semver: numerico, y un sufijo de prueba va antes que la version sin sufijo', () => {
    const orden = ['0.1.0-prueba.1', '0.1.0-rc.2', '0.1.0', '0.1.1', '0.1.10', '0.2.0', '1.0.0'];
    const mezcla = [...orden].reverse();
    expect(mezcla.sort(compararVersion)).toEqual(['0.1.0-prueba.1', '0.1.0-rc.2', '0.1.0', '0.1.1', '0.1.10', '0.2.0', '1.0.0']);
    expect(compararVersion('0.1.0', '0.1.0')).toBe(0);
    expect(() => compararVersion('latest', '0.1.0')).toThrow();
  });
  it('patch dentro del mismo minor; minor o mayor piden confirmacion por silo', () => {
    expect(tipoSalto('0.1.0', '0.1.1')).toBe('patch');
    expect(tipoSalto('0.1.9', '0.2.0')).toBe('minor');
    expect(tipoSalto('0.9.0', '1.0.0')).toBe('minor');
    expect(esPrueba('0.1.0-rc.1')).toBe(true);
    expect(esPrueba('0.1.0')).toBe(false);
  });
  it('promocion en orden demo -> beta -> estable; conflicto y versiones de prueba no llegan a estable', () => {
    const base = { version: '0.1.1', enDemoEn: null, enBetaEn: null, conflicto: null };
    expect(bloqueoPromocion(base, 'demo')).toBeNull();
    expect(bloqueoPromocion(base, 'beta')).toMatch(/demo/);
    expect(bloqueoPromocion({ ...base, enDemoEn: new Date() }, 'estable')).toMatch(/beta/);
    expect(bloqueoPromocion({ ...base, enDemoEn: new Date(), enBetaEn: new Date() }, 'estable')).toBeNull();
    expect(bloqueoPromocion({ ...base, version: '0.1.1-rc.1', enDemoEn: new Date(), enBetaEn: new Date() }, 'estable')).toMatch(/prueba/);
    expect(bloqueoPromocion({ ...base, conflicto: 'otros digests' }, 'demo')).toMatch(/conflicto/);
  });
});
