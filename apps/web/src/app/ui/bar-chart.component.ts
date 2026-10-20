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
  /** Texto completo del tooltip (p. ej. "186,4 km · 9 recorridos"); si falta se usa el valor formateado. */
  text?: string;
}

/**
 * Gráfica de barras de una sola serie: barras finas con extremo redondeado anclado a la línea base,
 * cuadrícula recesiva, tooltip al pasar el cursor y tabla oculta para lectores de pantalla.
 */
@Component({
  selector: 'app-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chart" [style.height.px]="height()" (mouseleave)="hover.set(null)">
      <svg [attr.width]="w()" [attr.height]="height()" role="img" [attr.aria-label]="ariaLabel()">
        @for (b of bars(); track b.i) {
          <path
            [attr.d]="b.path"
            class="bar"
            [class.on]="b.on"
            [class.grown]="grown()"
            [style.transition-delay]="grown() ? b.delay : '0ms'"
          />
          <text
            [attr.x]="b.cx"
            [attr.y]="height() - 4"
            text-anchor="middle"
            class="axis"
            [class.last]="b.last"
          >
            {{ b.label }}
          </text>
          <rect
            role="img"
            [attr.x]="b.x - b.gap / 2"
            y="0"
            [attr.width]="b.w + b.gap"
            [attr.height]="height() - padB"
            fill="transparent"
            (mouseenter)="hover.set(b.i)"
            (focus)="hover.set(b.i)"
            (blur)="hover.set(null)"
            tabindex="0"
            [attr.aria-label]="b.label + ': ' + b.text"
          />
        }
      </svg>
      <!-- Prototipo: el tooltip está siempre en la barra de hoy (la última) salvo que el cursor esté sobre otra -->
      @if (grown() && bars().length) {
        @let b = bars()[hover() ?? bars().length - 1];
        <div class="chart-tip" [class.edge-l]="narrow() && b.i === 0" [class.edge-r]="narrow() && b.last" [style.--tip-x]="b.cx + 'px'" [style.--tip-y]="b.top + 'px'">
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
      padding-top: 22px;
    }
    .chart {
      position: relative;
      width: 100%;
    }
    svg {
      overflow: visible;
    }
    .axis {
      fill: var(--wms-muted);
      font-size: 11px;
      font-weight: 400;
      font-variant-numeric: tabular-nums;
    }
    .axis.last {
      fill: var(--wms-text);
      font-weight: 600;
    }
    .bar {
      fill: var(--wms-bar-fill);
      transform-box: fill-box;
      transform-origin: 50% 100%;
      transform: scaleY(0);
      transition:
        transform var(--dur-4) var(--ease-out),
        fill var(--dur-2);
    }
    .bar.grown {
      transform: scaleY(1);
    }
    .bar.on {
      fill: var(--wms-text);
    }
    rect:focus {
      outline: none;
    }
    /* Móvil (prototipo): el tooltip de la primera/última barra se ancla al 22 % / 78 % para no salirse */
    .chart-tip.edge-l { transform: translate(var(--tip-x), var(--tip-y)) translate(-22%, calc(-100% - 8px)); }
    .chart-tip.edge-r { transform: translate(var(--tip-x), var(--tip-y)) translate(-78%, calc(-100% - 8px)); }
    .chart-tip span {
      font-weight: 600;
    }
    @media (prefers-reduced-motion: reduce) {
      .bar {
        transform: none;
        transition: fill var(--dur-2);
      }
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
  readonly padL = 0;
  readonly padB = 24;
  /** Ancho angosto (móvil): ajusta el anclaje del tooltip en los extremos. */
  readonly narrow = computed(() => this.w() < 520);
  /** Activa el crecimiento de las barras tras el primer frame (animación de entrada). */
  readonly grown = signal(false);
  private el = inject(ElementRef<HTMLElement>);
  private ro?: ResizeObserver;

  ngOnInit() {
    const RO: typeof ResizeObserver | undefined = (globalThis as any).ResizeObserver;
    if (!RO) {
      this.grown.set(true);
      return; // p. ej. jsdom en pruebas
    }
    this.ro = new RO(([e]) => this.w.set(Math.max(160, Math.floor(e.contentRect.width))));
    this.ro.observe(this.el.nativeElement);
    requestAnimationFrame(() => requestAnimationFrame(() => this.grown.set(true)));
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
    const n = Math.max(1, d.length);
    const gap = 10;
    const slot = this.w() / n;
    const bw = Math.max(4, Math.min(46, slot - gap));
    const h = this.height() - this.padB;
    const mx = Math.max(1, ...d.map((x) => x.value));
    const hov = this.hover();
    return d.map((x, i) => {
      const bh = x.value > 0 ? Math.max(4, (x.value / mx) * h) : 0;
      const bx = slot * i + (slot - bw) / 2;
      const top = h - bh;
      const r = Math.min(8, bw / 2, bh / 2);
      // Barra con las cuatro esquinas redondeadas (8 px), anclada a la base
      const path =
        bh === 0
          ? `M${bx},${h} L${bx + bw},${h} Z`
          : `M${bx + r},${top} L${bx + bw - r},${top} Q${bx + bw},${top} ${bx + bw},${top + r} L${bx + bw},${h - r} Q${bx + bw},${h} ${bx + bw - r},${h} L${bx + r},${h} Q${bx},${h} ${bx},${h - r} L${bx},${top + r} Q${bx},${top} ${bx + r},${top} Z`;
      const last = i === d.length - 1;
      return {
        i,
        x: bx,
        w: bw,
        gap: slot - bw,
        cx: bx + bw / 2,
        top,
        path,
        last,
        on: last || hov === i,
        delay: 300 + i * 60 + 'ms',
        label: x.label,
        tip: x.tip ?? x.label,
        text: x.text ?? this.fmt(x.value),
      };
    });
  });
}
