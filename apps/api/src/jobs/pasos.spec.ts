import { EJECUTABLES, enVentanaRespaldo, estadoTrasPasos, limpiarLog, pasosAReintentar, puedeCancelar } from './pasos';

describe('cola de jobs: reglas', () => {
  it('un paso FALLIDO detiene el job', () => {
    expect(estadoTrasPasos([{ estado: 'OK' }, { estado: 'FALLIDO' }, { estado: 'PENDIENTE' }])).toBe('FALLIDO');
  });
  it('todo OK u OMITIDO = job OK', () => {
    expect(estadoTrasPasos([{ estado: 'OK' }, { estado: 'OMITIDO' }])).toBe('OK');
  });
  it('con pasos pendientes sigue EN_CURSO', () => {
    expect(estadoTrasPasos([{ estado: 'OK' }, { estado: 'PENDIENTE' }])).toBe('EN_CURSO');
  });
  it('reintentar desde el paso fallido: los OK no se repiten', () => {
    expect(
      pasosAReintentar([
        { codigo: 'P0', estado: 'OK' },
        { codigo: 'V1', estado: 'OK' },
        { codigo: 'V2', estado: 'FALLIDO' },
        { codigo: 'V3', estado: 'PENDIENTE' },
      ]),
    ).toEqual(['V2']);
  });
  it('cancelar: activos y fallidos, no terminados', () => {
    expect(puedeCancelar('PENDIENTE')).toBe(true);
    expect(puedeCancelar('FALLIDO')).toBe(true);
    expect(puedeCancelar('OK')).toBe(false);
    expect(puedeCancelar('CANCELADO')).toBe(false);
  });
  it('ejecutables hoy: VERIFICAR, REINICIAR_SILO y RECONFIGURAR (R4), todos con P0 en el plano de control', () => {
    expect(Object.keys(EJECUTABLES)).toEqual(['VERIFICAR', 'REINICIAR_SILO', 'RECONFIGURAR']);
    expect(EJECUTABLES.RECONFIGURAR?.map((p) => p.codigo)).toEqual(['P0', 'C1', 'C2']);
    for (const defs of Object.values(EJECUTABLES)) expect(defs?.[0]).toMatchObject({ codigo: 'P0', ejecutor: 'control' });
  });
  it('ventana de respaldo: 01:45 a 02:30 en Chile', () => {
    expect(enVentanaRespaldo(new Date('2026-11-12T05:00:00Z'))).toBe(true); // 02:00 Chile
    expect(enVentanaRespaldo(new Date('2026-11-12T04:44:00Z'))).toBe(false); // 01:44
    expect(enVentanaRespaldo(new Date('2026-11-12T05:30:00Z'))).toBe(false); // 02:30
  });
  it('el log del agente se recorta (30 lineas, 300 caracteres, sin saltos)', () => {
    const l = limpiarLog([...Array(40)].map(() => 'x'.repeat(400) + '\nsecreto'));
    expect(l).toHaveLength(30);
    expect(l[0]).toHaveLength(300);
    expect(l[0]).not.toContain('\n');
    expect(limpiarLog('no es arreglo')).toEqual([]);
  });
});
