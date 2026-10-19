import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DebounceInputDirective, MorphWidthDirective } from './motion-directives';

@Component({
  imports: [DebounceInputDirective],
  template: `<input [value]="q()" wmsDebounce (debounced)="q.set($event)" />`,
})
class SearchHost {
  readonly q = signal('');
}

/** ResizeObserver de prueba: guarda el callback para dispararlo a mano con el ancho que se quiera. */
let resize: ((width: number) => void) | null = null;
class FakeResizeObserver {
  constructor(private cb: ResizeObserverCallback) {
    resize = (width) => this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as any);
  }
  observe() {}
  disconnect() {}
}

@Component({
  imports: [MorphWidthDirective],
  template: `<div [style.width.%]="w()" wmsMorphWidth></div>`,
})
class BarHost {
  readonly w = signal(40);
}

describe('DebounceInputDirective', () => {
  afterEach(() => vi.useRealTimers());

  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('emite el texto 180 ms después de la última tecla', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(SearchHost);
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    type(input, 'k');
    type(input, 'kl');
    vi.advanceTimersByTime(100);
    expect(fixture.componentInstance.q()).toBe('');
    type(input, 'klm');
    vi.advanceTimersByTime(179);
    expect(fixture.componentInstance.q()).toBe('');
    vi.advanceTimersByTime(1);
    expect(fixture.componentInstance.q()).toBe('klm');
  });

  it('emite al instante con Enter o al salir del campo', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(SearchHost);
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    type(input, 'abc');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(fixture.componentInstance.q()).toBe('abc');
    type(input, 'abcd');
    input.dispatchEvent(new Event('blur'));
    expect(fixture.componentInstance.q()).toBe('abcd');
    // sin cambios pendientes no vuelve a emitir
    fixture.componentInstance.q.set('otro');
    input.dispatchEvent(new Event('blur'));
    expect(fixture.componentInstance.q()).toBe('otro');
  });
});

describe('MorphWidthDirective', () => {
  afterEach(() => {
    delete (globalThis as any).ResizeObserver;
    resize = null;
  });

  it('anima el cambio de ancho con scaleX (anterior / nuevo → 1), no la primera medida', () => {
    (globalThis as any).ResizeObserver = FakeResizeObserver;
    (window as any).matchMedia ??= () => ({ matches: false });
    const fixture = TestBed.createComponent(BarHost);
    fixture.detectChanges();
    const bar: HTMLElement = fixture.nativeElement.querySelector('div');
    const animate = vi.fn(() => ({ cancel() {}, onfinish: null }));
    (bar as any).animate = animate;

    resize!(200); // primera medida: entrada a cargo del CSS
    expect(animate).not.toHaveBeenCalled();
    resize!(100); // el dato baja a la mitad
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames] = animate.mock.calls[0] as unknown as [Keyframe[]];
    expect(frames[0]['transform']).toBe('scaleX(2)');
    expect(frames[1]['transform']).toBe('scaleX(1)');
    expect(bar.style.transformOrigin).toBe('0 50%');
  });
});
