import { ACTIVOS, anterioresListos, EJECUTABLES, enVentanaRespaldo, ESPERAS, estadoTrasPasos, limpiarLog, pasosAReintentar, puedeCancelar, reintentoActualizar, siguientePaso } from './pasos';

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
  it('ejecutables hoy: VERIFICAR, REINICIAR_SILO, RECONFIGURAR (R4), los de la salida, APROVISIONAR y ACTUALIZAR, todos con P0 en el plano de control', () => {
    expect(Object.keys(EJECUTABLES)).toEqual(['VERIFICAR', 'REINICIAR_SILO', 'RECONFIGURAR', 'DETENER_SILO', 'REANUDAR_SILO', 'ELIMINAR', 'APROVISIONAR', 'ACTUALIZAR']);
    expect(EJECUTABLES.APROVISIONAR?.map((p) => `${p.codigo}:${p.ejecutor}`)).toEqual([
      'P0:control',
      'P1:control',
      'P2:agente',
      'P4:agente',
      'P5:operador',
      'P6:agente',
      'P7:agente',
      'P8:agente',
      'P9:agente',
      'P10:agente',
    ]);
    expect(EJECUTABLES.RECONFIGURAR?.map((p) => p.codigo)).toEqual(['P0', 'C1', 'C2']);
    expect(EJECUTABLES.ELIMINAR?.map((p) => p.codigo)).toEqual(['P0', 'X1', 'X2', 'X3']);
    for (const defs of Object.values(EJECUTABLES)) expect(defs?.[0]).toMatchObject({ codigo: expect.stringMatching(/^[PU]0$/), ejecutor: 'control' });
    expect(EJECUTABLES.ACTUALIZAR?.map((p) => `${p.codigo}:${p.ejecutor}`)).toEqual(['U0:control', 'UC:operador', 'U1:agente', 'U2:agente', 'U3:agente', 'U4:agente', 'U5:agente']);
  });
  it('el agente despacha por codigo: un codigo de paso del agente no se repite entre tipos', () => {
    const codigos = Object.values(EJECUTABLES).flatMap((d) => d!.filter((p) => p.ejecutor === 'agente').map((p) => p.codigo));
    expect(new Set(codigos).size).toBe(codigos.length);
  });
  it('orden: un paso corre solo con los anteriores OK u OMITIDO (incluido el manual)', () => {
    const pasos = [
      { orden: 0, estado: 'OK' as const },
      { orden: 1, estado: 'OMITIDO' as const },
      { orden: 2, estado: 'PENDIENTE' as const },
      { orden: 3, estado: 'PENDIENTE' as const },
    ];
    expect(anterioresListos(pasos, 2)).toBe(true);
    expect(anterioresListos(pasos, 3)).toBe(false);
    expect(siguientePaso(pasos)?.orden).toBe(2);
    expect(siguientePaso([{ orden: 0, estado: 'OK' as const }])).toBeUndefined();
  });
  it('esperas de APROVISIONAR: P6 sin llaves vuelve a P5; P8 sin dominio espera al operador en P8', () => {
    expect(ESPERAS.LLAVES).toEqual({ paso: 'P6', estado: 'ESPERANDO_LLAVES', reabre: 'P5' });
    expect(ESPERAS.DOMINIO).toEqual({ paso: 'P8', estado: 'ESPERANDO_OPERADOR', reabre: 'P8' });
    expect(ACTIVOS).toContain('ESPERANDO_OPERADOR');
    expect(puedeCancelar('ESPERANDO_OPERADOR')).toBe(true);
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

describe('reintento de ACTUALIZAR', () => {
  const p = (estados: Record<string, string>) => Object.entries(estados).map(([codigo, estado]) => ({ codigo, estado: estado as 'OK' }));
  it('un fallo despues del cambio de imagen (ya revertido) se rehace desde U2', () => {
    expect(reintentoActualizar(p({ U0: 'OK', UC: 'OMITIDO', U1: 'OK', U2: 'OK', U3: 'OK', U4: 'FALLIDO', U5: 'PENDIENTE' }))).toEqual(['U2', 'U3', 'U4', 'U5']);
    expect(reintentoActualizar(p({ U0: 'OK', UC: 'OMITIDO', U1: 'OK', U2: 'OK', U3: 'FALLIDO', U4: 'PENDIENTE', U5: 'PENDIENTE' }))).toEqual(['U2', 'U3', 'U4', 'U5']);
  });
  it('un fallo antes (respaldo o cambio de imagen) se reintenta desde ese paso', () => {
    expect(reintentoActualizar(p({ U0: 'OK', UC: 'OMITIDO', U1: 'FALLIDO', U2: 'PENDIENTE' }))).toEqual(['U1']);
  });
});
