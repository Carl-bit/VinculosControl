import { extenderVence, VIDA_DEMO_MS } from './demos.controller';

describe('vencimiento de demos', () => {
  const ahora = new Date('2026-11-19T15:00:00Z');
  const h = (n: number) => n * 60 * 60_000;

  it('extender suma 24 h a la fecha actual', () => {
    expect(extenderVence(new Date(ahora.getTime() + h(5)), ahora).getTime()).toBe(ahora.getTime() + h(5) + VIDA_DEMO_MS);
  });
  it('un demo ya vencido (o sin fecha) queda en 24 h desde ahora', () => {
    expect(extenderVence(new Date(ahora.getTime() - h(3)), ahora).getTime()).toBe(ahora.getTime() + VIDA_DEMO_MS);
    expect(extenderVence(null, ahora).getTime()).toBe(ahora.getTime() + VIDA_DEMO_MS);
  });
  it('tope de 7 dias desde ahora', () => {
    expect(extenderVence(new Date(ahora.getTime() + h(160)), ahora).getTime()).toBe(ahora.getTime() + h(168));
  });
});
