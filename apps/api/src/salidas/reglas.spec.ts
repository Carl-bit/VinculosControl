import { bloqueosEliminar, diasRestantes, erroresRecepcion, faltanEnChecklist, graciaHasta, pasos } from './reglas';

const H = 'a'.repeat(64);
const d = (s: string) => new Date(s);

describe('salidas: acta de recepcion', () => {
  const ahora = d('2026-12-10T12:00:00Z');
  const inicio = d('2026-12-01T12:00:00Z');
  const ok = { exporteEn: d('2026-12-05T10:00:00Z'), exporteHuella: H, firmadaEn: d('2026-12-06T10:00:00Z'), huellaActa: H.toUpperCase() };

  it('valida con huellas iguales (sin importar mayusculas)', () => {
    expect(erroresRecepcion(ok, inicio, ahora)).toEqual([]);
  });
  it('huellas distintas o mal formadas', () => {
    expect(erroresRecepcion({ ...ok, huellaActa: 'b'.repeat(64) }, inicio, ahora)).toEqual([expect.stringMatching(/no coincide/)]);
    expect(erroresRecepcion({ ...ok, exporteHuella: 'xyz' }, inicio, ahora)).toEqual([expect.stringMatching(/SHA-256/)]);
  });
  it('fechas: futuro, firma antes del exporte, exporte viejo', () => {
    expect(erroresRecepcion({ ...ok, firmadaEn: d('2026-12-11T00:00:00Z') }, inicio, ahora)).toEqual([expect.stringMatching(/futuro/)]);
    expect(erroresRecepcion({ ...ok, firmadaEn: d('2026-12-04T00:00:00Z') }, inicio, ahora)).toEqual([expect.stringMatching(/antes de generar/)]);
    expect(erroresRecepcion({ ...ok, exporteEn: d('2026-11-01T00:00:00Z') }, inicio, ahora)).toEqual([expect.stringMatching(/anterior al inicio/)]);
  });
});

describe('salidas: gracia y eliminacion', () => {
  it('la gracia corre desde la firma', () => {
    expect(graciaHasta(d('2026-12-06T10:00:00Z'), 30).toISOString()).toBe('2027-01-05T10:00:00.000Z');
    expect(diasRestantes(d('2027-01-05T10:00:00Z'), d('2027-01-04T11:00:00Z'))).toBe(1);
    expect(diasRestantes(d('2027-01-05T10:00:00Z'), d('2027-01-06T00:00:00Z'))).toBe(0);
  });
  it('eliminar exige GRACIA, silo detenido, confirmacion y gracia vencida', () => {
    const ahora = d('2027-01-10T00:00:00Z');
    const listo = { graciaHasta: d('2027-01-05T10:00:00Z'), siloDetenidoEn: d('2026-12-07T00:00:00Z'), confirmacionEn: d('2027-01-06T00:00:00Z') };
    expect(bloqueosEliminar(listo, 'GRACIA', ahora)).toEqual([]);
    expect(bloqueosEliminar({ ...listo, confirmacionEn: null }, 'GRACIA', ahora)).toEqual([expect.stringMatching(/confirmacion escrita/)]);
    expect(bloqueosEliminar({ ...listo, graciaHasta: d('2027-02-01T00:00:00Z') }, 'GRACIA', ahora)).toEqual([expect.stringMatching(/gracia vence 2027-02-01/)]);
    expect(bloqueosEliminar(listo, 'EXPORTADO', ahora)).toHaveLength(1);
  });
  it('checklist: lista lo que falta', () => {
    expect(faltanEnChecklist({ detenido: true, volumenes: true, respaldosHost: true, respaldosBucket: true, llaves: true, custodios: true, dominio: true, crontab: true })).toEqual([]);
    expect(faltanEnChecklist({ detenido: true, llaves: 'si' })).toHaveLength(7);
  });
});

describe('salidas: linea de tiempo', () => {
  const vacio: Parameters<typeof pasos>[1] = { graciaHasta: null, siloDetenidoEn: null, confirmacionEn: null, actaRecepcionHash: null, eliminadoEn: null };
  const estados = (e: Parameters<typeof pasos>[0], s = vacio) => Object.fromEntries(pasos(e, s).map((p) => [p.codigo, p.estado]));
  it('EN_SALIDA: S1 hecho, acta actual', () => {
    expect(estados('EN_SALIDA')).toMatchObject({ S1: 'hecho', 'S3-S4': 'actual', S5: 'actual', S6: 'pendiente', S7: 'pendiente' });
  });
  it('GRACIA con confirmacion: S7 actual', () => {
    const s = { ...vacio, actaRecepcionHash: 'h', siloDetenidoEn: new Date(), confirmacionEn: new Date() };
    expect(estados('GRACIA', s)).toMatchObject({ S5: 'hecho', S6: 'hecho', S6b: 'hecho', S7: 'actual', S8: 'pendiente' });
  });
});
