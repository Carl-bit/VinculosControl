import { fusionar, porEntregar, transicionValida } from './reglas';

describe('solicitudes de modulos (tarea 31)', () => {
  it('mismas transiciones que la BD del silo', () => {
    expect(transicionValida('PENDIENTE', 'APROBADA')).toBe(true);
    expect(transicionValida('PENDIENTE', 'RECHAZADA')).toBe(true);
    expect(transicionValida('PENDIENTE', 'APLICADA')).toBe(false);
    expect(transicionValida('APROBADA', 'APLICADA')).toBe(true);
    expect(transicionValida('APROBADA', 'RECHAZADA')).toBe(true);
    expect(transicionValida('APLICADA', 'RECHAZADA')).toBe(false);
    expect(transicionValida('RECHAZADA', 'APROBADA')).toBe(false);
  });

  it('nueva: la decision parte igual al silo', () => {
    expect(fusionar(null, 'PENDIENTE')).toEqual({ estado: 'PENDIENTE', estadoSilo: 'PENDIENTE' });
  });

  it('decision pendiente de entregar: el reporte del silo no la pisa', () => {
    const r = fusionar({ estado: 'APROBADA', estadoSilo: 'PENDIENTE' }, 'PENDIENTE');
    expect(r).toEqual({ estado: 'APROBADA', estadoSilo: 'PENDIENTE' });
    expect(porEntregar(r)).toBe(true);
  });

  it('entregada: el silo la confirma y no queda nada por entregar', () => {
    const r = fusionar({ estado: 'APROBADA', estadoSilo: 'PENDIENTE' }, 'APROBADA');
    expect(porEntregar(r)).toBe(false);
  });

  it('el silo avanzo mas alla: la decision lo sigue (nunca retrocede)', () => {
    expect(fusionar({ estado: 'APROBADA', estadoSilo: 'APROBADA' }, 'APLICADA').estado).toBe('APLICADA');
    expect(fusionar({ estado: 'APLICADA', estadoSilo: 'APROBADA' }, 'APROBADA').estado).toBe('APLICADA');
  });

  it('pendiente nunca se entrega (no hay decision)', () => {
    expect(porEntregar({ estado: 'PENDIENTE', estadoSilo: 'PENDIENTE' })).toBe(false);
  });
});
