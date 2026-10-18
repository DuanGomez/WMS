import { Directive, ElementRef, OnDestroy, OnInit, inject, output } from '@angular/core';
import { cssMs, cssVar, reducedMotion } from './motion';

/* Directivas de movimiento y de UI para las páginas (archivo aparte de motion.ts para no sumar
   su código al bundle inicial: solo las cargan las páginas que las usan). */

/**
 * Barra cuyo ancho cambia con los datos (el ancho final lo sigue fijando el template con [style.width.%]).
 * En lugar de animar `width` (layout en cada frame), aplica el ancho nuevo al instante y anima
 * el cambio con transform: scaleX(anterior / nuevo) → 1 (técnica FLIP). La entrada inicial la
 * siguen haciendo las animaciones CSS de cada barra.
 * Uso: <div [style.width.%]="v" wmsMorphWidth></div>
 */
@Directive({ selector: '[wmsMorphWidth]' })
export class MorphWidthDirective implements OnInit, OnDestroy {
  private el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private ro?: ResizeObserver;
  private w = -1;
  private anim?: Animation;

  ngOnInit() {
    const RO: typeof ResizeObserver | undefined = (globalThis as any).ResizeObserver;
    if (!RO) return; // p. ej. jsdom en pruebas
    // El callback llega después del layout y antes del pintado: el ancho nuevo nunca se ve sin animar.
    this.ro = new RO(([e]) => {
      const w = e.contentRect.width;
      const prev = this.w;
      this.w = w;
      if (prev <= 0 || w <= 0 || Math.abs(prev - w) < 0.5 || reducedMotion()) return;
      const from = this.anim ? this.currentScale() * (prev / w) : prev / w;
      this.anim?.cancel();
      this.el.style.transformOrigin = '0 50%';
      this.anim = this.el.animate([{ transform: `scaleX(${from})` }, { transform: 'scaleX(1)' }], {
        duration: cssMs('--dur-5', 1100),
        easing: cssVar('--ease-out', 'ease-out'),
      });
      this.anim.onfinish = () => (this.anim = undefined);
    });
    this.ro.observe(this.el);
  }
  /** Escala visible en este instante (si llega otro valor a mitad de animación, continúa desde ahí). */
  private currentScale() {
    const m = getComputedStyle(this.el).transform;
    const a = m.startsWith('matrix(') ? parseFloat(m.slice(7)) : 1;
    return isFinite(a) && a > 0 ? a : 1;
  }
  ngOnDestroy() {
    this.ro?.disconnect();
    this.anim?.cancel();
  }
}

/**
 * Búsqueda con debounce solo en la capa de UI: emite el texto 180 ms después de la última tecla
 * (al instante con Enter o al salir del campo). El filtrado de cada página no cambia.
 * Uso: <input [value]="q()" wmsDebounce (debounced)="q.set($event)" />
 */
@Directive({ selector: 'input[wmsDebounce]', host: { '(input)': 'queue()', '(keydown.enter)': 'flush()', '(blur)': 'flush()' } })
export class DebounceInputDirective implements OnDestroy {
  private el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  readonly debounced = output<string>();
  private t: ReturnType<typeof setTimeout> | null = null;

  queue() {
    if (this.t) clearTimeout(this.t);
    this.t = setTimeout(() => this.flush(), 180);
  }
  flush() {
    if (!this.t) return;
    clearTimeout(this.t);
    this.t = null;
    this.debounced.emit(this.el.value);
  }
  ngOnDestroy() {
    if (this.t) clearTimeout(this.t);
  }
}
