import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { Api } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { fmt, PRIORITY, VEHICLE_TYPES } from '../../core/format';
import { Alert } from '../../core/models';
import { IconComponent } from '../../ui/icon.component';
import { MorphWidthDirective } from '../../ui/motion-directives';
import { CountDirective } from '../../ui/wms-fx';

interface Dash {
  days: { day: string; km: number; alerts: number; trips: number }[];
  topVehicles: { id: string; plate: string; type: string; km: number }[];
}
type Range = 7 | 30 | 90;
/** Respuesta de GET analytics (ver backend-opcional/ANALYTICS.md). Si no existe, se usa GET dashboard. */
interface Analytics {
  range: Range;
  bucket: 'day' | 'week';
  days: { day: string; km: number; trips: number }[];
  prevDays: { day: string; km: number; trips: number }[];
  totals: { km: number; trips: number; prevKm: number; prevTrips: number };
  topDrivers: { id: string; name: string; km: number; trips: number }[];
}

const TYPE_LABELS: Record<string, string> = {
  geofence_enter: 'Entrada a geocerca',
  geofence_exit: 'Salida de geocerca',
  prolonged_stop: 'Parada prolongada',
  signal_loss: 'Pérdida de señal',
  route_deviation: 'Desvío de ruta',
  speeding: 'Exceso de velocidad',
  theft: 'Posible robo',
  low_battery: 'Batería baja',
  emergency: 'Emergencia',
  signal_restored: 'Señal recuperada',
};
const PRI = ['low', 'medium', 'high', 'critical'] as const;
const SEG = ['var(--wms-seg-2)', 'var(--wms-seg-3)', 'var(--wms-seg-4)', 'var(--wms-seg-5)'];
const C = 2 * Math.PI * 58;

/* ---- Transformación de la gráfica entre rangos (como runTween / mix / resample del prototipo) ---- */
/** Puntos fijos de la gráfica: 348 es múltiplo de 6, 12 y 29, así la curva pasa exacto por cada dato con 7, 13 o 30 valores. */
const N = 349;
const MORPH_MS = 900;
/** Lo que se dibuja: serie actual, periodo anterior (o null) y máximo del eje Y. */
interface Snap {
  cur: number[];
  prev: number[] | null;
  max: number;
}
/**
 * Remuestrea a N puntos siguiendo la misma curva que se dibujaba (cúbica con control en el punto medio):
 * en cada tramo x(t) = 1.5t − 1.5t² + t³ e y(t) = 3t² − 2t³; se despeja t con Newton.
 */
function resample(a: number[]): number[] {
  if (!a.length) return [];
  if (a.length === 1) return Array.from({ length: N }, () => a[0]);
  return Array.from({ length: N }, (_, j) => {
    const x = (j / (N - 1)) * (a.length - 1);
    const i = Math.min(Math.floor(x), a.length - 2);
    const f = x - i;
    let t = f;
    for (let k = 0; k < 6; k++) t -= (1.5 * t - 1.5 * t * t + t * t * t - f) / (1.5 - 3 * t + 3 * t * t);
    t = Math.min(1, Math.max(0, t));
    return a[i] + (a[i + 1] - a[i]) * (3 * t * t - 2 * t * t * t);
  });
}
/** Interpola valor por valor entre dos estados (e = 0 → a, e = 1 → b). */
function mix(a: Snap, b: Snap, e: number): Snap {
  const L = (x: number, y: number) => x + (y - x) * e;
  const M = (A: number[] | null, B: number[]) => B.map((y, i) => L(A?.[i] ?? 0, y));
  return { cur: M(a.cur, b.cur), prev: b.prev ? M(a.prev, b.prev) : null, max: L(a.max, b.max) };
}
const yOf = (v: number, max: number) => 230 - (v / max) * 220;
const pathOf = (vals: number[], max: number) =>
  vals.map((v, i) => `${i ? 'L' : 'M'}${((i / (vals.length - 1)) * 800).toFixed(1)},${yOf(v, max).toFixed(1)}`).join('');
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * "Actividad de la flota" (sección analítica de Reportes del prototipo).
 * Solo lectura y con endpoints existentes: GET dashboard (km/recorridos de 7 días y top
 * vehículos) y GET alerts?from&to (alertas del periodo y del periodo anterior).
 */
@Component({
  selector: 'app-fleet-activity',
  imports: [IconComponent, CountDirective, MorphWidthDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (show) {
    <section class="fa" aria-label="Actividad de la flota">
      <header class="fa-head">
        <div class="fa-titles">
          <span class="eb"><span>Resumen de la flota</span></span>
          <h2><span>Actividad de la flota</span></h2>
          <p><span>{{ an() ? 'Kilómetros, alertas y conductores del periodo seleccionado.' : 'Kilómetros de los últimos 7 días y alertas del periodo seleccionado.' }}</span></p>
        </div>
        <div class="seg" role="tablist" aria-label="Periodo">
          @for (r of ranges; track r.v) {
            <button type="button" role="tab" [attr.aria-selected]="range() === r.v" [class.on]="range() === r.v" (click)="setRange(r.v)">
              {{ r.l }}
            </button>
          }
        </div>
      </header>

      <div class="kgrid">
        @for (k of kpis(); track k.l) {
          <div class="card kc">
            <span class="kl">{{ k.l }}</span>
            <span class="kv"><span [wmsCount]="k.v" [decimals]="k.dec"></span>{{ k.unit }}</span>
            <span class="kd"><span class="pill">{{ k.d }}</span>{{ k.dl }}</span>
          </div>
        }
      </div>

      <div class="row1">
        <div class="card">
          <div class="ct">
            <div class="ctt"><span>Kilómetros recorridos</span><small>{{ kmSub() }}</small></div>
            <div class="legend">
              <span><i class="ln"></i>Este periodo</span>
              @if (an()) {
                <span><i class="ln prev"></i>Periodo anterior</span>
              }
            </div>
          </div>
          <div class="chart">
            <div class="ylab">
              @for (y of chart().ylab; track $index) {
                <span>{{ y }}</span>
              }
            </div>
            <div class="plotcol">
              <div class="plot" (mousemove)="move($event)" (mouseleave)="hov.set(null)">
                <div class="gridlines"><i></i><i></i><i></i><i></i><i class="base"></i></div>
                <svg viewBox="0 0 800 240" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="faArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" style="stop-color: var(--wms-text); stop-opacity: 0.22"></stop>
                      <stop offset="1" style="stop-color: var(--wms-text); stop-opacity: 0"></stop>
                    </linearGradient>
                  </defs>
                  <path class="area" [attr.d]="chart().area" fill="url(#faArea)"></path>
                  @if (chart().prev) {
                    <path class="prevline" [attr.d]="chart().prev"></path>
                  }
                  <path class="line" [attr.d]="chart().line" pathLength="1"></path>
                </svg>
                @if (hovPt(); as h) {
                  <div class="vline" [style.--x]="h.x"></div>
                  @if (h.yp != null) {
                    <span class="ptp" [style.--x]="h.x" [style.--y]="h.yp"></span>
                  }
                  <span class="pt" [style.--x]="h.x" [style.--y]="h.y"></span>
                  <div class="tip" [style.--x]="h.tipX">
                    <b>{{ h.label }}</b>
                    <span><span>Este periodo</span><b>{{ h.cur }}</b></span>
                    @if (h.prev != null) {
                      <span><span>Periodo anterior</span><b class="w5">{{ h.prev }}</b></span>
                    }
                    <span><span>Recorridos</span><b class="w5">{{ h.trips }}</b></span>
                  </div>
                }
              </div>
              <div class="xlab">
                @for (x of chart().xl; track $index) {
                  <span>{{ x }}</span>
                }
              </div>
            </div>
          </div>
        </div>

        <div class="card conv">
          <div class="ctt"><span>Alertas por tipo</span><small>Respecto a la más frecuente</small></div>
          @for (cv of conv(); track cv.k; let i = $index) {
            <div class="cvrow" [style.animation-delay]="300 + i * 60 + 'ms'">
              <span class="cvn"><b>{{ cv.n }}</b><small>{{ cv.cnt }}</small></span>
              <div class="cvt"><div [style.width.%]="cv.w" [style.background]="cv.c" wmsMorphWidth></div></div>
              <span class="cvp">{{ cv.pct }}</span>
            </div>
          } @empty {
            <div class="none">Sin alertas en el periodo.</div>
          }
        </div>
      </div>

      <div class="row2">
        <div class="card">
          <div class="ctt"><span>Alertas por prioridad</span><small>Participación en el periodo</small></div>
          <div class="donut-wrap" (mouseleave)="dHov.set(null)">
            <div class="donut">
              <svg width="180" height="180" viewBox="0 0 160 160">
                <circle cx="80" cy="80" r="58" fill="none" class="dtrack"></circle>
                @for (d of donut(); track d.k) {
                  <circle
                    cx="80"
                    cy="80"
                    r="58"
                    fill="none"
                    transform="rotate(-90 80 80)"
                    class="dseg"
                    [attr.stroke]="d.c"
                    [style.stroke-width]="d.on ? 17 : 13"
                    [style.stroke-dasharray]="d.dash"
                    [style.stroke-dashoffset]="d.off"
                    (mouseenter)="dHov.set(d.i)"
                  ></circle>
                }
              </svg>
              <div class="dc"><b>{{ center().pct }}</b><small>{{ center().n }}</small></div>
            </div>
            <div class="dleg">
              @for (d of donut(); track d.k) {
                <div class="dl" (mouseenter)="dHov.set(d.i)">
                  <i [style.background]="d.c"></i>
                  <span [class.on]="d.on">{{ d.n }}</span>
                  <b>{{ d.pct }}</b>
                </div>
              }
            </div>
          </div>
        </div>

        <div class="card">
          <div class="ctt"><span>{{ an() ? 'Conductores con más recorrido' : 'Vehículos con más recorrido' }}</span><small>{{ an() ? 'Kilómetros en el periodo' : 'Últimos 7 días' }}</small></div>
          @for (l of leaders(); track l.id; let i = $index) {
            <div class="ld" [style.animation-delay]="300 + i * 60 + 'ms'">
              <span class="rk">{{ i + 1 }}</span>
              <span class="av">
                @if (l.ini) {
                  {{ l.ini }}
                } @else {
                  <app-icon [name]="l.icon" [size]="14" />
                }
              </span>
              <div class="ldm"><span><b>{{ l.plate }}</b><small>{{ l.sub }}</small></span><b class="lv">{{ l.val }}</b></div>
              <span></span><span></span>
              <div class="ldt"><div [style.width.%]="l.w" wmsMorphWidth></div></div>
            </div>
          } @empty {
            <div class="none">Sin recorridos en el periodo.</div>
          }
        </div>
      </div>
    </section>
    }
  `,
  styles: `
    :host { display: block; margin-top: 18px; }
    .fa { display: flex; flex-direction: column; gap: 18px; }
    .fa-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; animation: wms-fade var(--dur-2) var(--ease-fade) backwards; }
    .fa-titles { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .fa-titles > * { overflow: hidden; padding-bottom: .08em; margin-bottom: -.08em; }
    .fa-titles > * > span { display: block; animation: wms-mask var(--dur-4) var(--ease) backwards; }
    .eb { font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--wms-muted); }
    .eb > span { animation-delay: 60ms !important; }
    h2 { margin: 0; font-size: 22px; line-height: 1.15; font-weight: 600; letter-spacing: -.02em; }
    h2 > span { animation-delay: 130ms !important; }
    .fa-titles p { margin: 0; font-size: 13px; color: var(--wms-muted); }
    .fa-titles p > span { animation-delay: 210ms !important; }
    .seg { display: flex; gap: 2px; padding: 3px; border-radius: 12px; border: 1px solid var(--wms-border); background: var(--wms-input); flex: none; }
    .seg button { height: 30px; padding: 0 12px; border-radius: 9px; border: 1px solid transparent; background: transparent; color: var(--wms-muted); font-size: 12px; font-weight: 500; cursor: pointer; transition: background var(--dur-2), color var(--dur-2), border-color var(--dur-2); }
    .seg button:hover { color: var(--wms-text); }
    .seg button.on { background: var(--wms-solid); border-color: var(--wms-solid); color: var(--wms-solid-text); font-weight: 600; }
    .kgrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
    .kgrid > *, .row1 > *, .row2 > * { animation: wms-in var(--dur-4) var(--ease) backwards; }
    .kgrid > :nth-child(1) { animation-delay: 140ms; } .kgrid > :nth-child(2) { animation-delay: 210ms; }
    .kgrid > :nth-child(3) { animation-delay: 280ms; } .kgrid > :nth-child(4) { animation-delay: 350ms; }
    .row1 > :nth-child(1) { animation-delay: 210ms; } .row1 > :nth-child(2) { animation-delay: 280ms; }
    .row2 > :nth-child(1) { animation-delay: 350ms; } .row2 > :nth-child(2) { animation-delay: 406ms; }
    .kc { display: flex; flex-direction: column; gap: 8px; }
    .kl { font-size: 12px; color: var(--wms-muted); }
    .kv { font-size: 32px; line-height: 1; font-weight: 600; letter-spacing: -.03em; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .kd { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--wms-muted); }
    .pill { height: 20px; padding: 0 8px; border-radius: 999px; background: var(--wms-chip); border: 1px solid var(--wms-chip-border); box-shadow: var(--wms-chip-shadow); color: var(--wms-text); font-size: 10px; font-weight: 600; display: flex; align-items: center; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .row1 { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr); gap: 18px; }
    .row2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; }
    .card { display: flex; flex-direction: column; gap: 12px; }
    .ct { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .ctt { display: flex; flex-direction: column; gap: 2px; }
    .ctt > span { font-size: 13px; font-weight: 600; }
    .ctt small { font-size: 11px; color: var(--wms-muted); }
    .legend { display: flex; gap: 12px; font-size: 11px; color: var(--wms-muted); }
    .legend span { display: flex; align-items: center; gap: 6px; }
    .legend .ln { width: 14px; height: 2px; border-radius: 2px; background: var(--wms-text); }
    .legend .ln.prev { height: 0; background: none; border-top: 2px dashed var(--wms-faint); border-radius: 0; }
    .prevline { fill: none; stroke: var(--wms-faint); stroke-width: 1.5; stroke-dasharray: 5 5; vector-effect: non-scaling-stroke; animation: wms-fade var(--dur-5) var(--ease-fade) .5s backwards; }
    .ptp { position: absolute; left: 0; top: 0; transform: translate(calc(var(--x) * 1cqw), calc(var(--y) * 1cqh)); width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 999px; background: var(--wms-page); border: 1.5px solid var(--wms-faint); pointer-events: none; transition: transform var(--dur-1); }
    .chart { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 6px; }
    .ylab { height: 240px; display: flex; flex-direction: column; justify-content: space-between; padding: 4px 0; }
    .ylab span, .xlab span { font-size: 10px; color: var(--wms-muted); font-variant-numeric: tabular-nums; line-height: 1; white-space: nowrap; }
    .plotcol { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    /* container-type: las marcas del cursor se posicionan con transform en unidades cqw/cqh (no left/top animados). */
    .plot { position: relative; container-type: size; height: 240px; cursor: crosshair; }
    .gridlines { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between; pointer-events: none; }
    .gridlines i { border-top: 1px dashed var(--wms-divider); }
    .gridlines i.base { border-top-style: solid; }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
    .area { animation: wms-fade var(--dur-5) var(--ease-fade) .4s backwards; }
    .line { fill: none; stroke: var(--wms-text); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-dasharray: 1; stroke-dashoffset: 0; animation: faDraw 1.4s var(--ease) .25s backwards; }
    @keyframes faDraw { from { stroke-dashoffset: 1; } }
    .vline { position: absolute; top: 0; bottom: 0; left: 0; transform: translateX(calc(var(--x) * 1cqw)); border-left: 1px dashed var(--wms-faint); pointer-events: none; }
    .pt { position: absolute; left: 0; top: 0; transform: translate(calc(var(--x) * 1cqw), calc(var(--y) * 1cqh)); width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 999px; background: var(--wms-text); box-shadow: 0 0 0 4px var(--wms-track); pointer-events: none; transition: transform var(--dur-1); }
    .tip { position: absolute; left: 0; top: 6px; transform: translateX(calc(var(--x) * 1cqw)) translateX(-50%); padding: 8px 10px; border-radius: 10px; background: var(--wms-panel); -webkit-backdrop-filter: blur(30px) saturate(190%); backdrop-filter: blur(30px) saturate(190%); border: 1px solid var(--wms-card-border); box-shadow: 0 12px 30px -12px rgba(0, 0, 0, .6); display: flex; flex-direction: column; gap: 4px; font-size: 11px; white-space: nowrap; pointer-events: none; transition: transform var(--dur-1); }
    .tip > span { display: flex; justify-content: space-between; gap: 14px; color: var(--wms-muted); }
    .tip b { color: var(--wms-text); font-weight: 600; }
    .tip b.w5 { font-weight: 500; }
    .xlab { display: flex; justify-content: space-between; }
    .conv { gap: 18px; }
    .cvrow { display: grid; grid-template-columns: 92px minmax(0, 1fr) 40px; align-items: center; gap: 10px; animation: wms-row-in var(--dur-4) var(--ease) backwards; }
    .cvn { display: flex; flex-direction: column; min-width: 0; }
    .cvn b { font-size: 12px; font-weight: 600; line-height: 1.2; text-wrap: pretty; }
    .cvn small { font-size: 11px; color: var(--wms-muted); font-variant-numeric: tabular-nums; }
    .cvt { height: 22px; border-radius: 7px; background: var(--wms-track); overflow: hidden; }
    .cvt > div { height: 100%; border-radius: 7px; transform-origin: left; animation: faGrow var(--dur-5) var(--ease-out) .4s backwards; }
    @keyframes faGrow { from { transform: scaleX(0); } }
    .cvp { font-size: 12px; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
    .donut-wrap { display: flex; align-items: center; justify-content: center; gap: 28px; flex-wrap: wrap; padding: 6px 0; }
    .donut { position: relative; width: 180px; height: 180px; flex: none; }
    .donut svg { position: static; width: 180px; height: 180px; pointer-events: auto; }
    .dtrack { stroke: var(--wms-track); stroke-width: 13; }
    .dseg { stroke-linecap: round; cursor: pointer; transition: stroke-width var(--dur-2), stroke-dasharray var(--dur-5) var(--ease-out), stroke-dashoffset var(--dur-5) var(--ease-out); animation: faDonut var(--dur-5) var(--ease) .35s backwards; }
    @keyframes faDonut { from { stroke-dasharray: 0 364.42; } }
    .dc { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; }
    .dc b { font-size: 30px; font-weight: 600; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
    .dc small { font-size: 11px; color: var(--wms-muted); }
    .dleg { display: flex; flex-direction: column; gap: 6px; min-width: 150px; }
    .dl { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; transition: background var(--dur-1); }
    .dl:hover { background: var(--wms-row-hover); }
    .dl i { width: 10px; height: 10px; border-radius: 3px; }
    .dl span { font-size: 12px; font-weight: 400; color: var(--wms-muted); transition: color var(--dur-1); }
    .dl span.on { font-weight: 600; color: var(--wms-text); }
    .dl b { margin-left: auto; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .ld { display: grid; grid-template-columns: 16px 30px minmax(0, 1fr); column-gap: 10px; row-gap: 6px; align-items: center; animation: wms-row-in var(--dur-4) var(--ease) backwards; }
    .rk { font-size: 12px; color: var(--wms-muted); font-variant-numeric: tabular-nums; }
    .av { font-size: 11px; font-weight: 600; width: 30px; height: 30px; border-radius: 999px; border: 1px solid var(--wms-border); background: var(--wms-input); display: grid; place-items: center; }
    .ldm { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .ldm > span { display: flex; flex-direction: column; min-width: 0; }
    .ldm b { font-size: 13px; font-weight: 600; }
    .ldm small { font-size: 11px; color: var(--wms-muted); }
    .ldm .lv { margin-left: auto; font-variant-numeric: tabular-nums; }
    .ldt { height: 4px; border-radius: 999px; background: var(--wms-track); overflow: hidden; }
    .ldt > div { height: 100%; border-radius: 999px; background: var(--wms-text); transform-origin: left; animation: faGrow var(--dur-5) var(--ease-out) .45s backwards; }
    .none { padding: 18px; border-radius: 12px; border: 1px dashed var(--wms-border); text-align: center; font-size: 12px; color: var(--wms-muted); }
    @media (max-width: 1100px) {
      .kgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .row1, .row2 { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 760px) {
      .kgrid { gap: 12px; }
      .kv { font-size: 26px; }
      .fa-head .seg { width: 100%; }
      .seg button { flex: 1; }
    }
  `,
})
export class FleetActivityComponent implements OnInit {
  private api = inject(Api);
  readonly auth = inject(Auth);
  readonly ranges: { v: Range; l: string }[] = [
    { v: 7, l: '7D' },
    { v: 30, l: '30D' },
    { v: 90, l: '90D' },
  ];
  readonly show = this.auth.can('dashboard') || this.auth.can('alerts');
  readonly range = signal<Range>(7);
  readonly dash = signal<Dash | null>(null);
  readonly an = signal<Analytics | null>(null);
  private noAnalytics = false;
  readonly cur = signal<Alert[]>([]);
  readonly prev = signal<Alert[]>([]);
  readonly hov = signal<number | null>(null);
  readonly dHov = signal<number | null>(null);

  readonly rangeLabel = computed(() => `Últimos ${this.range()} días`);
  readonly alertTotal = computed(() => this.cur().length);

  async ngOnInit() {
    try {
      if (this.auth.can('dashboard')) this.dash.set(await this.api.get<Dash>('dashboard'));
    } catch {}
    await Promise.all([this.loadKm(), this.loadAlerts()]);
  }
  setRange(r: Range) {
    if (r === this.range()) return;
    this.range.set(r);
    this.hov.set(null);
    this.loadKm();
    this.loadAlerts();
  }
  /** Usa GET analytics si el backend lo tiene; si no, se queda con los 7 días del dashboard. */
  private async loadKm() {
    if (this.noAnalytics || !this.auth.can('dashboard')) return;
    try {
      this.an.set(await this.api.get<Analytics>('analytics', { days: this.range() }));
    } catch {
      this.noAnalytics = true;
      this.an.set(null);
    }
  }
  readonly kmSub = computed(() => {
    const a = this.an();
    if (!a) return 'Por día · últimos 7 días';
    return 'Este periodo frente al anterior';
  });
  private series = computed(() => {
    const a = this.an();
    return a ? { cur: a.days, prev: a.prevDays as { km: number }[] | null } : { cur: this.dash()?.days ?? [], prev: null };
  });
  private async loadAlerts() {
    if (!this.auth.can('alerts')) return;
    const d = this.range() * 86400_000;
    const now = Date.now();
    const iso = (t: number) => new Date(t).toISOString();
    try {
      const [a, b] = await Promise.all([
        this.api.get<{ items: Alert[] }>('alerts', { from: iso(now - d), limit: 500 }),
        this.api.get<{ items: Alert[] }>('alerts', { from: iso(now - 2 * d), to: iso(now - d), limit: 500 }),
      ]);
      this.cur.set(a.items);
      this.prev.set(b.items);
    } catch {}
  }

  private delta(c: number, p: number) {
    if (!p) return c ? '+100%' : '0%';
    const v = Math.round(((c - p) / p) * 100);
    return (v > 0 ? '+' : '') + v + '%';
  }
  readonly kpis = computed(() => {
    const days = this.dash()?.days ?? [];
    const km = days.reduce((s, x) => s + x.km, 0);
    const trips = days.reduce((s, x) => s + x.trips, 0);
    const hot = (l: Alert[]) => l.filter((a) => a.priority === 'high' || a.priority === 'critical').length;
    const c = this.cur(), p = this.prev();
    return [
      ...(this.an()
        ? [
            { l: 'Kilómetros', v: this.an()!.totals.km, dec: 0, unit: ' km', d: this.delta(this.an()!.totals.km, this.an()!.totals.prevKm), dl: 'vs. periodo anterior' },
            { l: 'Recorridos', v: this.an()!.totals.trips, dec: 0, unit: '', d: this.delta(this.an()!.totals.trips, this.an()!.totals.prevTrips), dl: 'vs. periodo anterior' },
          ]
        : [
            { l: 'Kilómetros', v: km, dec: 0, unit: ' km', d: '7 días', dl: 'acumulado' },
            { l: 'Recorridos', v: trips, dec: 0, unit: '', d: '7 días', dl: 'acumulado' },
          ]),
      { l: 'Alertas', v: c.length, dec: 0, unit: '', d: this.delta(c.length, p.length), dl: 'vs. periodo anterior' },
      { l: 'Alertas alta o crítica', v: hot(c), dec: 0, unit: '', d: this.delta(hot(c), hot(p)), dl: 'vs. periodo anterior' },
    ];
  });

  /** Estado destino del rango elegido (datos reales: puntos para el tooltip y máximo del eje). */
  private target = computed(() => {
    const { cur: days, prev } = this.series();
    const vals = days.map((d) => d.km);
    const pvals = prev ? prev.map((d) => d.km) : [];
    const raw = Math.max(1, ...vals, ...pvals);
    const step = Math.pow(10, Math.floor(Math.log10(raw)));
    const max = Math.ceil(raw / step) * step;
    const n = Math.max(1, vals.length - 1);
    const toPts = (l: number[]) => l.map((v, i) => [(i / n) * 800, yOf(v, max)] as const);
    const snap: Snap = { cur: resample(vals), prev: prev ? resample(pvals) : null, max };
    return { snap, pts: toPts(vals), ppts: toPts(pvals) };
  });
  /** Lo que se ve ahora (puede estar a mitad de una transición). */
  private view = signal<Snap | null>(null);
  private raf = 0;

  constructor() {
    // Cada vez que cambia el destino, la gráfica se transforma desde lo que se ve en ese instante.
    effect(() => {
      const tg = this.target().snap;
      untracked(() => this.runTween(tg));
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.raf));
  }
  private runTween(tg: Snap) {
    cancelAnimationFrame(this.raf);
    const from = this.view();
    // Primera vez (o sin datos todavía): sin transformación; la animación de entrada la hace el CSS.
    if (!from || !from.cur.length || !tg.cur.length || reducedMotion()) {
      this.view.set(tg);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - t0) / MORPH_MS, 1);
      this.view.set(mix(from, tg, 1 - Math.pow(1 - p, 3)));
      if (p < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  readonly chart = computed(() => {
    const { cur: days } = this.series();
    const { snap, pts, ppts } = this.target();
    const v = this.view() ?? snap;
    const line = v.cur.length ? pathOf(v.cur, v.max) : '';
    const area = line ? `${line} L800,240 L0,240 Z` : '';
    const max = v.max;
    const wd = (iso: string) =>
      new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'short' }).format(new Date(iso)).replace('.', '');
    const weekly = this.an()?.bucket === 'week';
    const dm = (iso: string) =>
      new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short' }).format(new Date(iso)).replace('.', '');
    const every = days.length > 14 ? Math.ceil(days.length / 8) : 1;
    return {
      line,
      area,
      pts,
      ppts,
      prev: v.prev?.length ? pathOf(v.prev, v.max) : '',
      ylab: [1, 0.75, 0.5, 0.25, 0].map((k) => { const v = max * k; return v >= 1000 ? Math.round(v / 100) / 10 + 'k' : String(Math.round(v)); }),
      xl: days.filter((_, i) => i % every === 0).map((d) => (weekly || days.length > 7 ? dm(d.day) : wd(d.day))),
    };
  });
  readonly hovPt = computed(() => {
    const i = this.hov();
    const { cur: days, prev } = this.series();
    if (i == null || !days[i]) return null;
    const [x, y] = this.chart().pts[i];
    const pp = this.chart().ppts[i];
    const xp = (x / 800) * 100;
    return {
      x: xp,
      y: (y / 240) * 100,
      tipX: Math.min(82, Math.max(18, xp)),
      label: fmt.date(days[i].day),
      cur: `${fmt.num(days[i].km)} km`,
      trips: days[i].trips,
      yp: pp ? (pp[1] / 240) * 100 : null,
      prev: prev && prev[i] ? `${fmt.num(prev[i].km)} km` : null,
    };
  });
  move(e: MouseEvent) {
    const n = this.series().cur.length;
    if (!n) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
    this.hov.set(Math.max(0, Math.min(n - 1, i)));
  }

  readonly conv = computed(() => {
    const by: Record<string, number> = {};
    for (const a of this.cur()) by[a.type] = (by[a.type] ?? 0) + 1;
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const mx = rows[0]?.[1] ?? 1;
    return rows.map(([k, n], i) => ({
      k,
      n: TYPE_LABELS[k] ?? k,
      cnt: `${n} ${n === 1 ? 'alerta' : 'alertas'}`,
      w: (n / mx) * 100,
      pct: Math.round((n / mx) * 100) + '%',
      c: i === 4 ? 'var(--wms-text)' : 'var(--wms-bar-fill)',
    }));
  });

  readonly donut = computed(() => {
    const tot = this.cur().length || 1;
    const hov = this.dHov();
    let acc = 0;
    return PRI.map((k, i) => {
      const n = this.cur().filter((a) => a.priority === k).length;
      const len = (n / tot) * C;
      const gap = n && len > 6 ? 6 : 0;
      const seg = {
        k,
        i,
        n: PRIORITY[k].label,
        c: SEG[i],
        pct: Math.round((n / tot) * 100) + '%',
        dash: `${Math.max(0, len - gap)} 364.42`,
        off: -acc,
        on: hov === i,
      };
      acc += len;
      return seg;
    });
  });
  readonly center = computed(() => {
    const d = this.donut();
    const i = this.dHov() ?? d.reduce((b, x, j) => (parseInt(x.pct) > parseInt(d[b].pct) ? j : b), 0);
    return { pct: d[i]?.pct ?? '0%', n: d[i]?.n ?? '' };
  });

  readonly leaders = computed(() => {
    const a = this.an();
    if (a) {
      const mx = Math.max(1, ...a.topDrivers.map((d) => d.km));
      return a.topDrivers.map((d) => ({
        id: d.id,
        plate: d.name,
        ini: d.name.split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase(),
        icon: 'user',
        sub: `${d.trips} recorridos`,
        val: `${fmt.num(d.km)} km`,
        w: (d.km / mx) * 100,
      }));
    }
    const top = (this.dash()?.topVehicles ?? []).slice(0, 5);
    const mx = Math.max(1, ...top.map((t) => t.km));
    return top.map((t) => ({
      id: t.id,
      plate: t.plate,
      ini: '',
      icon: VEHICLE_TYPES[t.type]?.icon ?? 'car',
      sub: VEHICLE_TYPES[t.type]?.label ?? t.type,
      val: `${fmt.num(t.km)} km`,
      w: (t.km / mx) * 100,
    }));
  });
}
