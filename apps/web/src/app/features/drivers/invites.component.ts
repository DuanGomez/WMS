import { ChangeDetectionStrategy, Component, computed, effect, HostListener, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api.service';
import { DtPipe } from '../../core/format';
import { Confirm, Toasts } from '../../core/ui.services';
import { SheetComponent } from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';

interface Invite {
  id: string;
  code: string;
  label: string;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  active: boolean;
  valid: boolean;
}

/** Dibujo del código QR como un único <path> (sin innerHTML): nítido a cualquier tamaño y fácil de proyectar. */
interface QrPath {
  size: number;
  d: string;
}

async function qrPath(text: string): Promise<QrPath> {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return { size: n, d };
}

export const joinUrl = (code: string) => new URL(`unirse/${code}`, document.baseURI).href;

/**
 * Invitaciones de conductores: enlace y código QR para que cada persona se registre como conductor desde su
 * celular. «Proyectar» muestra el QR en grande (pensado para una exposición o una capacitación).
 */
@Component({
  selector: 'app-invites',
  imports: [FormsModule, SheetComponent, IconComponent, DtPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-sheet
      [(open)]="open"
      title="Invitar conductores"
      [actionText]="showForm() ? 'Crear invitación' : null"
      [busy]="busy()"
      (action)="create()"
      cancelText="Cerrar"
    >
      @if (current(); as inv) {
        <section class="inv-hero">
          <div class="qr" role="img" [attr.aria-label]="'Código QR para unirse: ' + link(inv)">
            @if (qr(); as q) {
              <svg [attr.viewBox]="'-2 -2 ' + (q.size + 4) + ' ' + (q.size + 4)" shape-rendering="crispEdges">
                <rect x="-2" y="-2" [attr.width]="q.size + 4" [attr.height]="q.size + 4" fill="#fff" />
                <path [attr.d]="q.d" fill="#000" />
              </svg>
            } @else {
              <div class="skeleton" style="width:100%;height:100%"></div>
            }
          </div>
          <div class="inv-info">
            <span class="eyebrow">{{ inv.label || 'Invitación' }}</span>
            <b class="code">{{ inv.code.slice(0, 4) }}-{{ inv.code.slice(4) }}</b>
            <p class="muted">
              {{ inv.uses }} {{ inv.uses === 1 ? 'persona registrada' : 'personas registradas' }}{{ inv.maxUses ? ' de ' + inv.maxUses : '' }}
              @if (inv.expiresAt) {
                · vence {{ inv.expiresAt | dt: 'relative' }}
              }
            </p>
            <div class="link-row">
              <input class="input" [value]="link(inv)" readonly aria-label="Enlace de la invitación" (focus)="$any($event.target).select()" />
              <button class="btn icon" type="button" title="Copiar enlace" aria-label="Copiar enlace" (click)="copy(inv)">
                <app-icon name="copy" [size]="15" />
              </button>
            </div>
            <div class="row" style="gap:8px;flex-wrap:wrap">
              <button class="btn primary" type="button" (click)="projecting.set(true)">
                <app-icon name="maximize" [size]="14" />Proyectar QR
              </button>
              @if (canShare) {
                <button class="btn" type="button" (click)="share(inv)"><app-icon name="share" [size]="14" />Compartir</button>
              }
              <button class="btn danger" type="button" (click)="revoke(inv)"><app-icon name="x" [size]="14" />Desactivar</button>
            </div>
          </div>
        </section>
      } @else if (!loading()) {
        <p class="muted intro">
          Crea un enlace con código QR. Cada persona que lo abra en su celular se registra como conductor de tu empresa y,
          al compartir su ubicación, aparece en el mapa en vivo.
        </p>
      }

      @if (showForm()) {
        <form class="form-grid new-inv" (ngSubmit)="create()">
          <div class="field full">
            <label for="il">Nombre de la invitación</label>
            <input id="il" class="input" name="il" [(ngModel)]="form.label" maxlength="60" placeholder="Exposición Ingeniería de Software II" />
          </div>
          <div class="field">
            <label for="ix">Vigencia</label>
            <select id="ix" class="select" name="ix" [(ngModel)]="form.hours">
              <option [ngValue]="6">6 horas</option>
              <option [ngValue]="24">1 día</option>
              <option [ngValue]="72">3 días</option>
              <option [ngValue]="168">1 semana</option>
              <option [ngValue]="720">30 días</option>
            </select>
          </div>
          <div class="field">
            <label for="im">Cupo</label>
            <select id="im" class="select" name="im" [(ngModel)]="form.maxUses">
              <option [ngValue]="null">Sin límite</option>
              <option [ngValue]="10">10 personas</option>
              <option [ngValue]="30">30 personas</option>
              <option [ngValue]="50">50 personas</option>
            </select>
          </div>
          <p class="muted full" style="margin:0;font-size:12px">El cupo también lo limita tu plan (usuarios permitidos).</p>
          <button type="submit" hidden></button>
        </form>
      } @else {
        <button class="btn" type="button" (click)="formOpen.set(true)" style="align-self:flex-start">
          <app-icon name="plus" [size]="14" />Nueva invitación
        </button>
      }

      @if (others().length) {
        <div class="others">
          <span class="label">Otras invitaciones</span>
          @for (i of others(); track i.id) {
            <button type="button" class="list-item clickable" (click)="select(i)" [class.inactive]="!i.valid">
              <span class="content">
                <span class="title">{{ i.label || 'Invitación' }} · {{ i.code }}</span>
                <span class="sub">{{ i.valid ? 'Vigente' : 'Inactiva' }} · {{ i.uses }} registrados · creada {{ i.createdAt | dt: 'relative' }}</span>
              </span>
              <app-icon name="chevron-right" [size]="14" class="faint" />
            </button>
          }
        </div>
      }
    </app-sheet>

    @if (projecting() && current(); as inv) {
      <div class="projector" role="dialog" aria-modal="true" aria-label="Código QR en pantalla completa" (click)="projecting.set(false)">
        <div class="pj-card" (click)="$event.stopPropagation()">
          <h2>Escanea y únete como conductor</h2>
          <p>Abre la cámara de tu celular y apunta al código</p>
          @if (qr(); as q) {
            <svg class="pj-qr" [attr.viewBox]="'-3 -3 ' + (q.size + 6) + ' ' + (q.size + 6)" shape-rendering="crispEdges">
              <rect x="-3" y="-3" [attr.width]="q.size + 6" [attr.height]="q.size + 6" fill="#fff" />
              <path [attr.d]="q.d" fill="#000" />
            </svg>
          }
          <b class="pj-code">{{ inv.code.slice(0, 4) }}-{{ inv.code.slice(4) }}</b>
          <span class="pj-url">{{ link(inv) }}</span>
          <button class="btn" type="button" (click)="projecting.set(false)"><app-icon name="x" [size]="14" />Cerrar</button>
        </div>
      </div>
    }
  `,
  styles: `
    .inv-hero { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 18px; align-items: center; }
    .qr { width: 180px; aspect-ratio: 1; border-radius: 14px; overflow: hidden; background: #fff; box-shadow: 0 0 0 1px var(--wms-border); }
    .qr svg { display: block; width: 100%; height: 100%; }
    .inv-info { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .code { font-size: 26px; font-weight: 650; letter-spacing: .08em; font-variant-numeric: tabular-nums; }
    .muted { color: var(--wms-muted); font-size: 13px; margin: 0; line-height: 1.5; }
    .intro { margin-bottom: 4px; }
    .link-row { display: flex; gap: 6px; }
    .link-row .input { flex: 1; min-width: 0; font-size: 12px; }
    .new-inv { margin-top: 18px; }
    .others { display: flex; flex-direction: column; gap: 6px; margin-top: 18px; }
    .others .label { font-size: 12px; font-weight: 600; color: var(--wms-muted); }
    .others .list-item { width: 100%; text-align: left; border: 0; background: none; color: inherit; font: inherit; }
    @media (max-width: 560px) {
      .inv-hero { grid-template-columns: minmax(0, 1fr); justify-items: center; text-align: center; }
      .inv-info { align-items: center; width: 100%; }
      .link-row { width: 100%; }
      .qr { width: min(240px, 70vw); }
    }
    /* Proyección: fondo blanco y QR negro siempre (contraste máximo para las cámaras), sin importar el tema */
    /* Por encima de los avisos (z-index 4000): nada debe tapar el código mientras lo escanean */
    .projector { position: fixed; inset: 0; z-index: 5000; display: grid; place-items: center; padding: 24px; background: rgba(0, 0, 0, 0.72); }
    .pj-card { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: clamp(16px, 3vh, 28px) 32px; border-radius: 24px; background: #fff; color: #111; max-width: 96vw; max-height: 96dvh; overflow: auto; }
    .pj-card h2 { margin: 0; font-size: clamp(20px, 3vw, 34px); font-weight: 650; text-align: center; }
    .pj-card p { margin: 0; color: #555; font-size: clamp(13px, 1.6vw, 18px); }
    .pj-qr { width: min(54dvh, 80vw); height: auto; display: block; flex: none; }
    .pj-code { font-size: clamp(22px, 3.4vw, 40px); letter-spacing: .12em; font-variant-numeric: tabular-nums; }
    .pj-url { font-size: clamp(12px, 1.4vw, 16px); color: #444; word-break: break-all; text-align: center; }
    .pj-card .btn { color: #111; background: #f2f2f2; border-color: #ddd; }
  `,
})
export class InvitesComponent {
  private api = inject(Api);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  readonly open = model(false);
  readonly invites = signal<Invite[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly formOpen = signal(false);
  readonly projecting = signal(false);
  readonly qr = signal<QrPath | null>(null);
  readonly canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  form: { label: string; hours: number; maxUses: number | null } = { label: 'Exposición', hours: 24, maxUses: null };

  readonly current = computed(() => {
    const list = this.invites();
    return list.find((i) => i.id === this.selectedId()) ?? list.find((i) => i.valid) ?? null;
  });
  readonly others = computed(() => this.invites().filter((i) => i.id !== this.current()?.id).slice(0, 8));
  /** Sin invitación vigente el formulario se muestra de una vez. */
  readonly showForm = computed(() => this.formOpen() || (!this.loading() && !this.current()));

  constructor() {
    effect(() => {
      if (this.open()) void this.load();
      else {
        this.formOpen.set(false);
        this.projecting.set(false);
      }
    });
    effect(() => {
      const inv = this.current();
      this.qr.set(null);
      if (inv) void qrPath(joinUrl(inv.code)).then((q) => this.current()?.code === inv.code && this.qr.set(q));
    });
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    if (this.projecting()) this.projecting.set(false);
  }

  link(i: Invite) {
    return joinUrl(i.code);
  }

  async load() {
    this.loading.set(true);
    try {
      this.invites.set(await this.api.get<Invite[]>('invites'));
    } catch (e) {
      this.toasts.error('No se pudieron cargar las invitaciones', errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  select(i: Invite) {
    this.selectedId.set(i.id);
    this.formOpen.set(false);
  }

  async create() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const inv = await this.api.post<Invite>('invites', {
        label: this.form.label,
        expiresInHours: this.form.hours,
        maxUses: this.form.maxUses,
      });
      this.invites.update((l) => [inv, ...l]);
      this.selectedId.set(inv.id);
      this.formOpen.set(false);
      this.toasts.success('Invitación creada', 'Comparte el enlace o proyecta el código QR.');
    } catch (e) {
      this.toasts.error('No se pudo crear la invitación', errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async copy(i: Invite) {
    try {
      await navigator.clipboard.writeText(this.link(i));
      this.toasts.success('Enlace copiado');
    } catch {
      this.toasts.error('No se pudo copiar', 'Selecciona el enlace y cópialo manualmente.');
    }
  }

  async share(i: Invite) {
    await navigator
      .share({ title: 'Únete como conductor en WMS', text: 'Regístrate como conductor con este enlace:', url: this.link(i) })
      .catch(() => {});
  }

  async revoke(i: Invite) {
    const ok = await this.confirm.ask({
      title: '¿Desactivar la invitación?',
      message: 'El enlace y el código QR dejarán de funcionar. Las personas ya registradas conservan su cuenta.',
      confirmText: 'Desactivar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(`invites/${i.id}`);
      this.invites.update((l) => l.map((x) => (x.id === i.id ? { ...x, active: false, valid: false } : x)));
      if (this.selectedId() === i.id) this.selectedId.set(null);
    } catch (e) {
      this.toasts.error('No se pudo desactivar', errorMessage(e));
    }
  }
}
