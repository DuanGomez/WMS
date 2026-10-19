import { ChangeDetectionStrategy, Component, HostListener, input, model } from '@angular/core';
import { IconComponent } from './icon.component';

export interface DetailRow {
  k: string;
  v: string;
  mono?: boolean;
}

/**
 * Panel lateral "Detalle" del prototipo (clic en una fila): cabecera centrada con avatar o ícono,
 * título, subtítulo y chip; lista de datos; y acciones proyectadas (<ng-content>).
 * Solo presentación: los botones que se proyectan llaman a los métodos que ya tiene cada página.
 */
@Component({
  selector: 'app-detail',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="backdrop" animate.leave="wms-leave-fade" (click)="open.set(false)"></div>
      <aside class="sheet detail" animate.leave="wms-leave-sheet" role="dialog" aria-modal="true" [attr.aria-label]="title()">
        <div class="sheet-handle"></div>
        <div class="d-body">
          <div class="d-close">
            <button type="button" aria-label="Cerrar" (click)="open.set(false)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"></path></svg>
            </button>
          </div>
          <div class="d-head">
            <span class="d-av" [class.tile]="!ini()">
              @if (ini()) {
                {{ ini() }}
              } @else {
                <app-icon [name]="icon()" [size]="24" />
              }
            </span>
            <span class="d-title">{{ title() }}</span>
            @if (sub()) {
              <span class="d-sub">{{ sub() }}</span>
            }
            @if (chip()) {
              <span class="badge" [class.solid]="chipTone() === 'solid'" [class.off]="chipTone() === 'off'">{{ chip() }}</span>
            }
          </div>
          @if (rows().length) {
            <div class="d-rows">
              @for (r of rows(); track r.k) {
                <div><span>{{ r.k }}</span><b [class.mono]="r.mono">{{ r.v }}</b></div>
              }
            </div>
          }
          <div class="d-actions"><ng-content /></div>
        </div>
      </aside>
    }
  `,
  styles: `
    .detail { width: min(440px, calc(100vw - 24px)); }
    .d-body { padding: 20px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; flex: 1; }
    .d-close { display: flex; justify-content: flex-end; }
    .d-close button { flex: none; width: 30px; height: 30px; border-radius: 999px; border: 1px solid var(--wms-border); background: var(--wms-input); color: var(--wms-text); display: grid; place-items: center; cursor: pointer; padding: 0; transition: background var(--dur-2), transform var(--dur-1); }
    .d-close button:hover { background: var(--wms-row-hover); }
    .d-close button:active { transform: scale(.92); }
    .d-head { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; margin-top: -14px; }
    .d-head > * { animation: wms-in var(--dur-3) var(--ease) backwards; }
    .d-head > :nth-child(2) { animation-delay: 60ms; } .d-head > :nth-child(3) { animation-delay: 110ms; } .d-head > :nth-child(4) { animation-delay: 160ms; }
    .d-av { width: 64px; height: 64px; border-radius: 999px; border: 1px solid var(--wms-border); background: var(--wms-input); display: grid; place-items: center; font-size: 22px; font-weight: 600; margin-bottom: 8px; }
    .d-av.tile { border-radius: 18px; }
    .d-title { font-size: 20px; line-height: 1.15; font-weight: 600; letter-spacing: -.02em; }
    .d-sub { font-size: 12px; color: var(--wms-muted); margin-bottom: 6px; text-wrap: pretty; }
    .d-rows { display: flex; flex-direction: column; border-radius: 12px; border: 1px solid var(--wms-divider); background: var(--wms-soft); overflow: hidden; animation: wms-in var(--dur-3) var(--ease) .2s backwards; }
    .d-rows > div { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; padding: 10px 12px; font-size: 12px; border-bottom: 1px solid var(--wms-divider); min-width: 0; }
    .d-rows > div:last-child { border-bottom: 0; }
    .d-rows span { flex: none; color: var(--wms-muted); }
    .d-rows b { font-weight: 600; text-align: right; min-width: 0; overflow-wrap: anywhere; }
    .d-actions { display: flex; flex-wrap: wrap; gap: 8px; animation: wms-in var(--dur-3) var(--ease) .26s backwards; }
    .d-actions:empty { display: none; }
    .d-actions ::ng-deep .btn { flex: 1 1 auto; height: 40px; }
  `,
})
export class DetailComponent {
  readonly open = model(false);
  readonly title = input('');
  readonly sub = input('');
  readonly ini = input('');
  readonly icon = input('info');
  readonly chip = input('');
  readonly chipTone = input<'solid' | 'on' | 'off'>('on');
  readonly rows = input<DetailRow[]>([]);

  @HostListener('document:keydown.escape')
  esc() {
    if (this.open()) this.open.set(false);
  }
}
