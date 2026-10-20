import {
  afterRenderEffect,
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Confirm, Toasts } from '../core/ui.services';
import { IconComponent } from './icon.component';
import { cssMs, cssVar, reducedMotion } from './motion';

/** Hoja modal (sheet) con handle en móvil, cierre con Esc y clic en el fondo. */
@Component({
  selector: 'app-sheet',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="backdrop" animate.leave="wms-leave-fade" (click)="close()"></div>
      <section
        class="sheet"
        animate.leave="wms-leave-sheet"
        [class.wide]="wide()"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
        tabindex="-1"
        #panel
        (keydown.tab)="trap($event)"
        (keydown.shift.tab)="trap($event)"
      >
        <div class="sheet-handle" aria-hidden="true"></div>
        <header class="sheet-header">
          <h2 [id]="titleId">{{ title() }}</h2>
          <button class="sheet-close" type="button" [attr.aria-label]="actionText() ? 'Cerrar sin guardar' : cancelText()" (click)="close()">
            <app-icon name="x" [size]="16" />
          </button>
        </header>
        <div class="sheet-body"><ng-content /></div>
        <!-- Acciones siempre visibles al pie del panel (aunque el formulario sea largo) -->
        @if (actionText()) {
          <footer class="sheet-foot">
            <button class="btn" type="button" (click)="close()">{{ cancelText() }}</button>
            <button class="btn primary" type="button" [disabled]="busy() || actionDisabled()" (click)="action.emit()">
              @if (busy()) {
                <app-icon name="refresh" [size]="16" class="spin" />
              }
              {{ actionText() }}
            </button>
          </footer>
        }
      </section>
    }
  `,
})
export class SheetComponent {
  readonly open = model(false);
  readonly title = input('');
  readonly actionText = input<string | null>(null);
  readonly cancelText = input('Cancelar');
  readonly busy = input(false);
  readonly actionDisabled = input(false);
  readonly wide = input(false);
  readonly action = output<void>();
  readonly closed = output<void>();
  readonly titleId = 'sheet-t-' + Math.random().toString(36).slice(2, 8);
  private panel = viewChild<ElementRef<HTMLElement>>('panel');
  private opener: HTMLElement | null = null;

  constructor() {
    // Accesibilidad: al abrir, el foco pasa al primer campo; al cerrar, vuelve al botón que abrió el panel.
    effect(() => {
      if (this.open()) {
        this.opener = document.activeElement as HTMLElement | null;
        setTimeout(() => {
          const el = this.panel()?.nativeElement;
          const first = el?.querySelector<HTMLElement>('.sheet-body input:not([type=hidden]):not([disabled]), .sheet-body select, .sheet-body textarea');
          (first ?? el)?.focus({ preventScroll: true });
        }, 60);
      } else if (this.opener) {
        this.opener.focus?.({ preventScroll: true });
        this.opener = null;
      }
    });
  }

  close() {
    this.open.set(false);
    this.closed.emit();
  }

  /** Mantiene el foco del teclado dentro del panel mientras está abierto (diálogo modal). */
  trap(e: Event) {
    const ev = e as KeyboardEvent;
    const el = this.panel()?.nativeElement;
    if (!el) return;
    const items = Array.from(
      el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (ev.shiftKey && (document.activeElement === first || document.activeElement === el)) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    if (this.open()) this.close();
  }
}

/** Control segmentado de iOS con "thumb" animado. */
@Component({
  selector: 'app-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="segmented" role="tablist">
      <span #thumbEl class="thumb" [style.left.px]="thumb().left" [style.width.px]="thumb().width"></span>
      @for (o of options(); track o.value) {
        <button
          #btn
          type="button"
          role="tab"
          [attr.aria-selected]="o.value === value()"
          (click)="select(o.value)"
        >
          {{ o.label }}
        </button>
      }
    </div>
  `,
})
export class SegmentedComponent implements AfterViewInit {
  readonly options = input.required<{ value: string; label: string }[]>();
  readonly value = model.required<string>();
  private buttons = viewChildren<ElementRef<HTMLButtonElement>>('btn');
  private thumbEl = viewChild<ElementRef<HTMLElement>>('thumbEl');
  private measured = signal(0);
  private prevThumb: { left: number; width: number } | null = null;
  readonly thumb = computed(() => {
    this.measured();
    const idx = this.options().findIndex((o) => o.value === this.value());
    const el = this.buttons()[idx]?.nativeElement;
    return el ? { left: el.offsetLeft, width: el.offsetWidth } : { left: 2, width: 0 };
  });

  constructor() {
    effect(() => {
      this.options();
      requestAnimationFrame(() => this.measured.update((n) => n + 1));
    });
    // Vuelve a medir cuando cambia el tamaño de un botón: la hoja aún abriéndose (botones de 0 px),
    // la fuente que termina de cargar o la traducción a inglés. Sin esto el indicador quedaba en 0 px
    // y solo se veía su borde como una franja clara a la izquierda.
    const RO: typeof ResizeObserver | undefined = (globalThis as any).ResizeObserver;
    if (RO) {
      const ro = new RO(() => this.measured.update((n) => n + 1));
      effect(() => this.buttons().forEach((b) => ro.observe(b.nativeElement, { box: 'border-box' })));
      inject(DestroyRef).onDestroy(() => ro.disconnect());
    }
    // FLIP: left/width se aplican al instante (mismo resultado final) y el cambio se anima solo con transform.
    afterRenderEffect(() => {
      const t = this.thumb();
      const el = this.thumbEl()?.nativeElement;
      const p = this.prevThumb;
      this.prevThumb = t;
      if (!el || !p || !p.width || !t.width || (p.left === t.left && p.width === t.width) || reducedMotion()) return;
      el.animate(
        [{ transform: `translateX(${p.left - t.left}px) scaleX(${p.width / t.width})` }, { transform: 'none' }],
        { duration: cssMs('--dur-3', 450), easing: cssVar('--ease', 'ease') },
      );
    });
  }
  ngAfterViewInit() {
    requestAnimationFrame(() => this.measured.update((n) => n + 1));
    document.fonts?.ready.then(() => this.measured.update((n) => n + 1));
  }
  @HostListener('window:resize')
  onResize() {
    this.measured.update((n) => n + 1);
  }
  select(v: string) {
    this.value.set(v);
  }
}

/** Interruptor estilo iOS. */
@Component({
  selector: 'app-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button
    type="button"
    class="toggle"
    role="switch"
    [class.on]="value()"
    [attr.aria-checked]="value()"
    [attr.aria-label]="label()"
    [disabled]="disabled()"
    (click)="value.set(!value()); changed.emit(value())"
  ></button>`,
})
export class ToggleComponent {
  readonly value = model(false);
  readonly label = input('');
  readonly disabled = input(false);
  readonly changed = output<boolean>();
}

@Component({
  selector: 'app-empty',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="empty">
      <div class="empty-icon"><app-icon [name]="icon()" [size]="28" /></div>
      <h3>{{ title() }}</h3>
      @if (text()) {
        <p class="footnote" style="max-width:360px">{{ text() }}</p>
      }
      <ng-content />
    </div>
  `,
})
export class EmptyComponent {
  readonly icon = input('sparkles');
  readonly title = input.required<string>();
  readonly text = input('');
}

@Component({
  selector: 'app-skeleton-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="list" aria-busy="true" aria-label="Cargando">
      @for (i of rows(); track i) {
        <div class="list-item">
          <div class="skeleton" style="width:32px;height:32px;border-radius:9px"></div>
          <div class="content stack" style="gap:6px">
            <div class="skeleton" style="height:12px;width:40%"></div>
            <div class="skeleton" style="height:10px;width:65%"></div>
          </div>
        </div>
      }
    </div>
  `,
})
export class SkeletonListComponent {
  readonly count = input(5);
  readonly rows = computed(() => Array.from({ length: this.count() }, (_, i) => i));
}

/** Capa global: notificaciones tipo iOS y diálogos de confirmación. */
@Component({
  selector: 'app-overlays',
  imports: [IconComponent, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" aria-live="polite">
      @for (t of toasts.items(); track t.id) {
        <div
          class="toast glass-thick"
          [class.leaving]="t.leaving"
          role="status"
          (click)="t.action?.(); toasts.dismiss(t.id)"
        >
          <div class="toast-icon" [class]="'toast-icon bg-' + t.tone">
            <app-icon [name]="t.icon" [size]="20" />
          </div>
          <div style="flex:1;min-width:0">
            <div class="toast-app">
              <span>{{ t.app ?? 'WMS' }}</span
              ><span>ahora</span>
            </div>
            <div class="toast-title">{{ t.title }}</div>
            @if (t.text) {
              <div class="toast-text">{{ t.text }}</div>
            }
          </div>
        </div>
      }
    </div>

    @if (confirm.current(); as c) {
      <div class="backdrop" style="z-index:3000" animate.leave="wms-leave-fade" (click)="confirm.close(false)"></div>
      <div
        class="alert-dialog glass-thick"
        animate.leave="wms-leave-dialog"
        role="alertdialog"
        aria-modal="true"
        [attr.aria-label]="c.title"
      >
        <div class="alert-body">
          <h3>{{ c.title }}</h3>
          @if (c.message) {
            <p>{{ c.message }}</p>
          }
          @if (c.input) {
            <div class="alert-input">
              @if (c.input.options) {
                <select class="select" [(ngModel)]="c.value" aria-label="Opción">
                  @for (o of c.input.options; track o.value) {
                    <option [value]="o.value">{{ o.label }}</option>
                  }
                </select>
              } @else {
                <input
                  class="input"
                  [(ngModel)]="c.value"
                  [placeholder]="c.input.placeholder ?? ''"
                  (keydown.enter)="confirm.close(true)"
                />
              }
            </div>
          }
        </div>
        <div class="alert-actions">
          <button type="button" (click)="confirm.close(false)">
            {{ c.cancelText ?? 'Cancelar' }}
          </button>
          <button
            type="button"
            class="bold"
            [class.destructive]="c.destructive"
            (click)="confirm.close(true)"
          >
            {{ c.confirmText ?? 'Aceptar' }}
          </button>
        </div>
      </div>
    }
  `,
})
export class OverlaysComponent {
  readonly toasts = inject(Toasts);
  readonly confirm = inject(Confirm);

  @HostListener('document:keydown.escape')
  onEsc() {
    if (this.confirm.current()) this.confirm.close(false);
  }
}
