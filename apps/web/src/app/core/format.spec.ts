import { describe, expect, it } from 'vitest';
import { fmt } from './format';

describe('formatos es-CO / America/Bogota', () => {
  it('moneda en pesos colombianos sin decimales', () => {
    expect(fmt.cop(249000).replace(/\s/g, ' ')).toMatch(/\$\s?249\.000/);
  });

  it('convierte entre datetime-local (Bogotá) e ISO UTC', () => {
    const iso = fmt.fromLocalInput('2026-10-12T08:30');
    expect(iso).toBe('2026-10-12T13:30:00.000Z');
    expect(fmt.toLocalInput(new Date(iso))).toBe('2026-10-12T08:30');
  });

  it('duraciones legibles', () => {
    expect(fmt.duration(25)).toBe('25 s');
    expect(fmt.duration(125)).toBe('2 min 5 s');
    expect(fmt.duration(3720)).toBe('1 h 2 min');
  });

  it('tiempo relativo', () => {
    expect(fmt.relative(new Date())).toBe('ahora');
    expect(fmt.relative(null)).toBe('—');
  });
});
