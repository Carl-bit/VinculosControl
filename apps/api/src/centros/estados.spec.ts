import type { EstadoCentro } from '@prisma/client';

import { ANTES_DE_APROBADO, puedeTransitar, TRANSICIONES, validarTransicionManual } from './estados';

describe('maquina de estados del centro', () => {
  it('pipeline comercial en orden, sin saltos', () => {
    expect(puedeTransitar('SOLICITUD', 'CONTACTADO')).toBe(true);
    expect(puedeTransitar('CONTACTADO', 'REUNION')).toBe(true);
    expect(puedeTransitar('REUNION', 'DATOS_COMPLETOS')).toBe(true);
    expect(puedeTransitar('DATOS_COMPLETOS', 'APROBADO')).toBe(true);
    expect(puedeTransitar('SOLICITUD', 'REUNION')).toBe(false);
    expect(puedeTransitar('SOLICITUD', 'APROBADO')).toBe(false);
  });

  it('DESCARTADO solo antes de APROBADO', () => {
    for (const e of Object.keys(TRANSICIONES) as EstadoCentro[]) {
      expect(puedeTransitar(e, 'DESCARTADO')).toBe(ANTES_DE_APROBADO.includes(e));
    }
  });

  it('ACTIVO <-> SUSPENDIDO y salida desde ambos', () => {
    expect(puedeTransitar('ACTIVO', 'SUSPENDIDO')).toBe(true);
    expect(puedeTransitar('SUSPENDIDO', 'ACTIVO')).toBe(true);
    expect(puedeTransitar('SUSPENDIDO', 'EN_SALIDA')).toBe(true);
    // Reversion de una salida: vuelve al estado previo; despues de ELIMINADO no.
    expect(puedeTransitar('EN_SALIDA', 'ACTIVO')).toBe(true);
    expect(puedeTransitar('GRACIA', 'SUSPENDIDO')).toBe(true);
    expect(puedeTransitar('EN_SALIDA', 'APROBADO')).toBe(false);
  });

  it('ELIMINADO y DESCARTADO son finales', () => {
    expect(TRANSICIONES.ELIMINADO).toEqual([]);
    expect(TRANSICIONES.DESCARTADO).toEqual([]);
  });

  describe('transiciones manuales de la consola', () => {
    it('permite contactar y agendar reunion', () => {
      expect(validarTransicionManual('SOLICITUD', 'CONTACTADO')).toBeNull();
      expect(validarTransicionManual('CONTACTADO', 'REUNION')).toBeNull();
    });
    it('descartar exige motivo', () => {
      expect(validarTransicionManual('REUNION', 'DESCARTADO', '  ')).toMatch(/motivo/);
      expect(validarTransicionManual('REUNION', 'DESCARTADO', 'No respondio')).toBeNull();
    });
    it('DATOS_COMPLETOS si (el servicio exige los datos del centro); APROBADO no (endpoint propio con P0)', () => {
      expect(validarTransicionManual('REUNION', 'DATOS_COMPLETOS')).toBeNull();
      expect(validarTransicionManual('DATOS_COMPLETOS', 'APROBADO')).toMatch(/no se marca a mano/);
    });
    it('respeta el orden', () => {
      expect(validarTransicionManual('SOLICITUD', 'REUNION')).toMatch(/No se puede/);
      expect(validarTransicionManual('APROBADO', 'DESCARTADO', 'x')).toMatch(/No se puede/);
    });
  });
});
