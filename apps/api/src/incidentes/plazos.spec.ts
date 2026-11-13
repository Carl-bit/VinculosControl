import { estadoSoporte, hitos, semaforo, sumarHabiles, venceSoporte } from './plazos';

// Jueves 12-nov-2026 10:00 en Chile (UTC-3).
const jueves = new Date('2026-11-12T13:00:00Z');
const h = (n: number) => new Date(jueves.getTime() + n * 3_600_000);
const base = { detectadoEn: jueves, contenidoEn: null, avisoCentroEn: null, ultimaActualizacionEn: null, informeFinalEn: null, cerradoEn: null };

describe('plazos de incidentes', () => {
  it('dias habiles: saltan sabado y domingo', () => {
    expect(sumarHabiles(jueves, 1).toISOString()).toBe('2026-11-13T13:00:00.000Z'); // viernes
    expect(sumarHabiles(jueves, 2).toISOString()).toBe('2026-11-16T13:00:00.000Z'); // lunes
    expect(sumarHabiles(jueves, 10).toISOString()).toBe('2026-11-26T13:00:00.000Z');
  });

  it('S1: contencion en 1 h, aviso en 24 h, informe en 10 dias habiles', () => {
    const [c, a, i] = hitos({ ...base, severidad: 'S1' }, h(0.5));
    expect(c.venceEn).toEqual(h(1));
    expect(a.venceEn).toEqual(h(24));
    expect(i.venceEn?.toISOString()).toBe('2026-11-26T13:00:00.000Z');
    expect(c.estado).toBe('pendiente');
  });

  it('por vencer en el ultimo 25 % y vencido despues', () => {
    expect(hitos({ ...base, severidad: 'S1' }, h(0.8))[0].estado).toBe('por_vencer');
    expect(hitos({ ...base, severidad: 'S1' }, h(2))[0].estado).toBe('vencido');
  });

  it('cumplido a tiempo o tarde', () => {
    expect(hitos({ ...base, severidad: 'S2', contenidoEn: h(3) }, h(10))[0].estado).toBe('cumplido');
    expect(hitos({ ...base, severidad: 'S2', contenidoEn: h(5) }, h(10))[0].estado).toBe('cumplido_tarde');
  });

  it('actualizaciones cada 24 h (S1) desde el aviso o la ultima, hasta el informe final', () => {
    const conAviso = hitos({ ...base, severidad: 'S1', contenidoEn: h(0.5), avisoCentroEn: h(2) }, h(3));
    expect(conAviso.find((x) => x.clave === 'actualizacion')?.venceEn).toEqual(h(26));
    const conUltima = hitos({ ...base, severidad: 'S1', avisoCentroEn: h(2), ultimaActualizacionEn: h(20) }, h(21));
    expect(conUltima.find((x) => x.clave === 'actualizacion')?.venceEn).toEqual(h(44));
    const conInforme = hitos({ ...base, severidad: 'S1', avisoCentroEn: h(2), informeFinalEn: h(30) }, h(31));
    expect(conInforme.find((x) => x.clave === 'actualizacion')).toBeUndefined();
  });

  it('S3: aviso por informe mensual (no aplica), sin actualizaciones, informe en 20 dias habiles', () => {
    const hs = hitos({ ...base, severidad: 'S3' }, h(1));
    expect(hs.find((x) => x.clave === 'aviso_centro')?.estado).toBe('no_aplica');
    expect(hs.find((x) => x.clave === 'actualizacion')).toBeUndefined();
    expect(hs[0].venceEn?.toISOString()).toBe('2026-11-16T13:00:00.000Z'); // 2 dias habiles
  });

  it('semaforo: manda el peor', () => {
    expect(semaforo(hitos({ ...base, severidad: 'S1' }, h(2)))).toBe('vencido');
    expect(semaforo(hitos({ ...base, severidad: 'S1' }, h(0.1)))).toBe('al_dia');
  });
});

describe('soporte', () => {
  it('la autorizacion vence a las horas pedidas y la abierta vencida se ve VENCIDA', () => {
    const v = venceSoporte(jueves, 24);
    expect(v).toEqual(h(24));
    expect(estadoSoporte({ estado: 'ABIERTA', venceEn: v }, h(25))).toBe('VENCIDA');
    expect(estadoSoporte({ estado: 'ABIERTA', venceEn: v }, h(1))).toBe('ABIERTA');
    expect(estadoSoporte({ estado: 'CERRADA', venceEn: v }, h(25))).toBe('CERRADA');
  });
});
