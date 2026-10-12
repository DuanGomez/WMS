import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';

export interface BarDatum {
  label: string;
  value: number;
  tip?: string;
}

/**
 * Gráfica de barras de una sola serie: barras finas con extremo redondeado anclado a la línea base,
 * cuadrícula recesiva, tooltip al pasar el cursor y tabla oculta para lectores de pantalla.
 */
@Component({
  selector: 'app-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chart" [style.height.px]="height()">
      <svg [attr.width]="w()" [attr.height]="height()" role="img" [attr.aria-label]="ariaLabel()">
        @for (g of grid(); track g.y) {
          <line [attr.x1]="padL" [attr.x2]="w()" [attr.y1]="g.y" [attr.y2]="g.y" class="grid" />
          <text [attr.x]="padL - 6" [attr.y]="g.y + 4" text-anchor="end" class="axis">
            {{ g.label }}
          </text>
        }
        @for (b of bars(); track b.i) {
          <path
            [attr.d]="b.path"
            [attr.fill]="color()"
            [attr.opacity]="hover() === null || hover() === b.i ? 1 : 0.45"
            class="bar"
          />
          <text [attr.x]="b.cx" [attr.y]="height() - 6" text-anchor="middle" class="axis">
            {{ b.label }}
          </text>
          <rect
            [attr.x]="b.x - b.gap / 2"
            y="0"
            [attr.width]="b.w + b.gap"
            [attr.height]="height() - padB"
            fill="transparent"
            (mouseenter)="hover.set(b.i)"
            (mouseleave)="hover.set(null)"
            (focus)="hover.set(b.i)"
            (blur)="hover.set(null)"
            tabindex="0"
            [attr.aria-label]="b.label + ': ' + b.text"
          />
        }
      </svg>
      @if (hover() !== null) {
        @let b = bars()[hover()!];
        <div class="chart-tip glass-thick" [style.left.px]="b.cx" [style.top.px]="b.top">
          <div class="caption">{{ b.tip }}</div>
          <strong>{{ b.text }}</strong>
        </div>
      }
    </div>
    <table class="sr-only">
      <caption>
        {{
          ariaLabel()
        }}
      </caption>
      <tbody>
        @for (d of data(); track $index) {
          <tr>
            <th scope="row">{{ d.tip ?? d.label }}</th>
            <td>{{ fmt(d.value) }}</td>
          </tr>
        }
      </tbody>
    </table>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
    }
    .chart {
      position: relative;
      width: 100%;
    }
    svg {
      overflow: visible;
    }
    .grid {
      stroke: var(--separator);
      stroke-width: 0.5;
    }
    .axis {
      fill: var(--label-2);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    .bar {
      transition: opacity 160ms;
    }
    rect:focus {
      outline: none;
    }
  `,
})
export class BarChartComponent implements OnInit, OnDestroy {
  readonly data = input.required<BarDatum[]>();
  readonly color = input('var(--blue)');
  readonly unit = input('');
  readonly decimals = input(0);
  readonly height = input(180);
  readonly ariaLabel = input('Gráfica de barras');
  readonly hover = signal<number | null>(null);
  readonly w = signal(300);
  readonly padL = 34;
  readonly padB = 24;
  private el = inject(ElementRef<HTMLElement>);
  private ro?: ResizeObserver;

  ngOnInit() {
    const RO: typeof ResizeObserver | undefined = (globalThis as any).ResizeObserver;
    if (!RO) return; // p. ej. jsdom en pruebas
    this.ro = new RO(([e]) => this.w.set(Math.max(160, Math.floor(e.contentRect.width))));
    this.ro.observe(this.el.nativeElement);
  }
  ngOnDestroy() {
    this.ro?.disconnect();
  }

  fmt(v: number) {
    return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: this.decimals() }).format(v)}${this.unit() ? ' ' + this.unit() : ''}`;
  }

  private readonly max = computed(() => {
    const m = Math.max(1, ...this.data().map((d) => d.value));
    const step = Math.pow(10, Math.floor(Math.log10(m)));
    return Math.ceil(m / step) * step;
  });

  readonly grid = computed(() => {
    const h = this.height() - this.padB - 8;
    return [0, 0.5, 1].map((k) => ({
      y: 8 + h * (1 - k),
      label: new Intl.NumberFormat('es-CO', {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(this.max() * k),
    }));
  });

  readonly bars = computed(() => {
    const d = this.data();
    const plotW = this.w() - this.padL;
    const slot = plotW / Math.max(1, d.length);
    const bw = Math.min(28, slot * 0.56);
    const h = this.height() - this.padB - 8;
    const base = 8 + h;
    return d.map((x, i) => {
      const bh = x.value > 0 ? Math.max(4, (x.value / this.max()) * h) : 0;
      const bx = this.padL + slot * i + (slot - bw) / 2;
      const r = Math.min(4, bw / 2, bh);
      const top = base - bh;
      // Rectángulo con esquinas superiores redondeadas (4 px) anclado a la línea base
      const path =
        bh === 0
          ? ''
          : `M${bx},${base} L${bx},${top + r} Q${bx},${top} ${bx + r},${top} L${bx + bw - r},${top} Q${bx + bw},${top} ${bx + bw},${top + r} L${bx + bw},${base} Z`;
      return {
        i,
        x: bx,
        w: bw,
        gap: slot - bw,
        cx: bx + bw / 2,
        top,
        path,
        label: x.label,
        tip: x.tip ?? x.label,
        text: this.fmt(x.value),
      };
    });
  });
}
