import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { BarChartComponent } from './bar-chart.component';

// jsdom no implementa ResizeObserver
(globalThis as any).ResizeObserver ??= class {
  observe() {}
  disconnect() {}
};

describe('BarChartComponent', () => {
  it('dibuja una barra por dato con tabla accesible', async () => {
    const fixture = TestBed.createComponent(BarChartComponent);
    fixture.componentRef.setInput('data', [
      { label: 'lun', value: 10 },
      { label: 'mar', value: 25 },
      { label: 'mié', value: 0 },
    ]);
    fixture.componentRef.setInput('unit', 'km');
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('path.bar').length).toBe(3);
    expect(el.querySelectorAll('table tr').length).toBe(3);
    expect(el.textContent).toContain('25 km');
  });
});
