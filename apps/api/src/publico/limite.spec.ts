import { LimitePorIp } from './limite';

describe('limite por IP del formulario publico', () => {
  it('5 por hora y luego bloquea', () => {
    const l = new LimitePorIp(5, 3_600_000);
    for (let i = 0; i < 5; i++) expect(l.permitir('1.2.3.4', 1000 + i)).toBe(true);
    expect(l.permitir('1.2.3.4', 2000)).toBe(false);
  });
  it('cada IP cuenta por separado', () => {
    const l = new LimitePorIp(1, 3_600_000);
    expect(l.permitir('1.1.1.1', 0)).toBe(true);
    expect(l.permitir('2.2.2.2', 0)).toBe(true);
    expect(l.permitir('1.1.1.1', 1)).toBe(false);
  });
  it('se libera al pasar la ventana', () => {
    const l = new LimitePorIp(1, 1000);
    expect(l.permitir('1.1.1.1', 0)).toBe(true);
    expect(l.permitir('1.1.1.1', 999)).toBe(false);
    expect(l.permitir('1.1.1.1', 1001)).toBe(true);
  });
});
