import { fusionar, porEntregar, type Registrada, revertirRechazo, siguienteEntrega, transicionValida } from './reglas';

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

  it('entrega de a un paso: APLICADA con el silo en PENDIENTE pasa primero por APROBADA', () => {
    expect(siguienteEntrega({ estado: 'APLICADA', estadoSilo: 'PENDIENTE' })).toBe('APROBADA');
    expect(siguienteEntrega({ estado: 'APLICADA', estadoSilo: 'APROBADA' })).toBe('APLICADA');
    expect(siguienteEntrega({ estado: 'RECHAZADA', estadoSilo: 'PENDIENTE' })).toBe('RECHAZADA');
    expect(transicionValida('PENDIENTE', siguienteEntrega({ estado: 'APLICADA', estadoSilo: 'PENDIENTE' }))).toBe(true);
  });

  it('pendiente nunca se entrega (no hay decision)', () => {
    expect(porEntregar({ estado: 'PENDIENTE', estadoSilo: 'PENDIENTE' })).toBe(false);
  });
});

describe('APLICADA rechazada por el silo', () => {
  it('4xx definitivo: vuelve a APROBADA y no queda nada por entregar', () => {
    const r: Registrada = { estado: 'APLICADA', estadoSilo: 'APROBADA' };
    expect(revertirRechazo(r, 'HTTP 422 Los modulos activos del centro aun no reflejan la solicitud')).toBe('APROBADA');
    expect(porEntregar({ estado: 'APROBADA', estadoSilo: 'APROBADA' })).toBe(false);
  });

  it('red o 5xx: se reintenta', () => {
    const r: Registrada = { estado: 'APLICADA', estadoSilo: 'APROBADA' };
    expect(revertirRechazo(r, 'TypeError: fetch failed')).toBeNull();
    expect(revertirRechazo(r, 'HTTP 503 no disponible')).toBeNull();
  });

  it('solo aplica a APLICADA sobre APROBADA', () => {
    expect(revertirRechazo({ estado: 'APROBADA', estadoSilo: 'PENDIENTE' }, 'HTTP 409 x')).toBeNull();
    expect(revertirRechazo({ estado: 'APLICADA', estadoSilo: 'PENDIENTE' }, 'HTTP 422 x')).toBeNull();
  });
});
