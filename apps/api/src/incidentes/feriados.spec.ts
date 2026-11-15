import { esFeriado, feriadosExtra, feriadosLegales, pascua, solsticioInvierno, trasladarAlLunes } from './feriados';
import { sumarHabiles } from './plazos';

const fechas = (anio: number) => feriadosLegales(anio).map((f) => f.fecha);

describe('feriados de Chile (port de feriados_legales del ERP)', () => {
  it('Pascua', () => {
    expect(pascua(2025)).toBe('2025-04-20');
    expect(pascua(2026)).toBe('2026-04-05');
    expect(pascua(2027)).toBe('2027-03-28');
  });

  it('solsticio de invierno (Pueblos Indigenas)', () => {
    expect(solsticioInvierno(2025)).toBe('2025-06-20');
    expect(solsticioInvierno(2026)).toBe('2026-06-21');
    expect(solsticioInvierno(2027)).toBe('2027-06-21');
  });

  it('traslado al lunes (Ley 19.668)', () => {
    expect(trasladarAlLunes('2026-06-29')).toBe('2026-06-29'); // lunes: queda
    expect(trasladarAlLunes('2027-06-29')).toBe('2027-06-28'); // martes -> lunes anterior
    expect(trasladarAlLunes('2026-10-12')).toBe('2026-10-12'); // lunes
    expect(trasladarAlLunes('2029-10-12')).toBe('2029-10-15'); // viernes -> lunes siguiente
  });

  it('calendario 2026 completo', () => {
    expect(fechas(2026)).toEqual([
      '2026-01-01', '2026-04-03', '2026-04-04', '2026-05-01', '2026-05-21', '2026-06-21', '2026-06-29', '2026-07-16',
      '2026-08-15', '2026-09-18', '2026-09-19', '2026-10-12', '2026-10-31', '2026-11-01', '2026-12-08', '2026-12-25',
    ]);
  });

  it('reglas condicionales: 2 de enero, 17 y 20 de septiembre, Iglesias Evangelicas', () => {
    expect(fechas(2023)).toContain('2023-01-02'); // 1-1-2023 domingo
    expect(fechas(2026)).not.toContain('2026-01-02');
    expect(fechas(2027)).toContain('2027-09-17'); // viernes
    expect(fechas(2029)).toContain('2029-09-17'); // lunes
    expect(fechas(2030)).toContain('2030-09-20'); // viernes
    expect(fechas(2028)).toContain('2028-10-27'); // 31-10-2028 martes -> viernes 27
    expect(fechas(2029)).toContain('2029-11-02'); // 31-10-2029 miercoles -> viernes 2-11
  });

  it('FERIADOS_EXTRA: solo fechas validas', () => {
    const extra = feriadosExtra(' 2026-12-31, nada,2026-13-40 ,2027-01-04');
    expect([...extra]).toEqual(['2026-12-31', '2027-01-04']);
    expect(esFeriado('2026-12-31', extra)).toBe(true);
    expect(esFeriado('2026-12-31')).toBe(false);
  });

  it('dias habiles saltan feriados: 10 habiles desde el lunes 7-dic-2026 pasan por el 8 y el 25', () => {
    const lunes = new Date('2026-12-07T13:00:00Z'); // 10:00 Chile
    expect(sumarHabiles(lunes, 1).toISOString()).toBe('2026-12-09T13:00:00.000Z'); // salta el 8
    expect(sumarHabiles(lunes, 10).toISOString()).toBe('2026-12-22T13:00:00.000Z');
    expect(sumarHabiles(lunes, 14, new Set()).toISOString()).toBe('2026-12-29T13:00:00.000Z'); // salta el 25
    expect(sumarHabiles(lunes, 14, new Set(['2026-12-28'])).toISOString()).toBe('2026-12-30T13:00:00.000Z');
  });
});
