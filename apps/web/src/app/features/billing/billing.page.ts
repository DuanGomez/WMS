import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { CopPipe, DtPipe } from '../../core/format';
import { Invoice, Plan, Session, Subscription } from '../../core/models';
import { Confirm, Toasts } from '../../core/ui.services';
import { SheetComponent } from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';
import { MorphWidthDirective } from '../../ui/motion-directives';

const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: 'Activa', tone: 'green' },
  trialing: { label: 'Prueba', tone: 'blue' },
  past_due: { label: 'Pago pendiente', tone: 'orange' },
  canceled: { label: 'Cancelada', tone: 'red' },
};

/** RG7 / RE9 / RF23-RF26 – Plan de suscripción, uso, facturas y datos de la empresa. */
@Component({
  selector: 'app-billing',
  imports: [FormsModule, IconComponent, SheetComponent, CopPipe, DtPipe, MorphWidthDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="eyebrow">Gestión</div>
          <h1 class="large-title">Suscripción y facturación</h1>
        </div>
      </header>

      @if (sub(); as s) {
        @if (s.status === 'canceled') {
          <div class="banner">
            <app-icon name="info" [size]="16" />
            <span>
              Cancelada el {{ s.canceledAt | dt: 'date' }}. Motivo: {{ s.cancelReason || '—' }}. Puedes consultar tus
              datos, pero no crear registros hasta reactivar un plan.
            </span>
          </div>
        }
        <div class="bgrid">
          <section class="card bc full">
            <div class="bc-head">
              <div class="bc-t"><span>Plan actual</span><small>{{ s.plan.description }}</small></div>
              <span class="badge" [class.solid]="s.status !== 'canceled'" [class.off]="s.status === 'canceled'">{{ s.status === 'canceled' ? 'Cancelada' : 'Activa' }}</span>
            </div>
            <div class="big"><b>{{ s.plan.priceCop | cop }}</b><small>/ mes + IVA · plan {{ s.plan.name }}</small></div>
            <div class="meter">
              <div class="mrow"><span>Vehículos</span><b>{{ s.usage.vehicles }} / {{ s.plan.maxVehicles }}</b></div>
              <div class="track"><div class="fill" [class.warn]="s.usage.vehicles / s.plan.maxVehicles > 0.8" [style.width.%]="(s.usage.vehicles / s.plan.maxVehicles) * 100" wmsMorphWidth></div></div>
            </div>
            <div class="meter">
              <div class="mrow"><span>Usuarios</span><b>{{ s.usage.users }} / {{ s.plan.maxUsers }}</b></div>
              <div class="track"><div class="fill" [class.warn]="s.usage.users / s.plan.maxUsers > 0.8" [style.width.%]="(s.usage.users / s.plan.maxUsers) * 100" wmsMorphWidth></div></div>
            </div>
            <div class="kv"><span>Periodo actual</span><b>{{ s.currentPeriodStart | dt: 'short' }} – {{ s.currentPeriodEnd | dt: 'short' }}</b></div>
            <div class="kv"><span>Cliente desde</span><b>{{ s.startedAt | dt: 'short' }}</b></div>
          </section>

          @for (p of plans(); track p.code) {
            @let isCur = p.code === s.plan.code && s.status !== 'canceled';
            <article class="card bc plan" [class.current-plan]="isCur">
              <div class="bc-head">
                <div class="bc-t"><span>{{ p.name }}</span><small>{{ p.description }}</small></div>
                @if (p.code === 'pro') {
                  <span class="badge">Más elegido</span>
                }
              </div>
              <div class="big"><b>{{ p.priceCop | cop }}</b><small>/mes</small></div>
              <ul>
                @for (f of p.features; track f) {
                  <li><span class="ck"><app-icon name="check" [size]="10" [stroke]="3" /></span>{{ f }}</li>
                }
              </ul>
              <div class="btns">
                @if (isCur) {
                  <button class="btn" type="button" disabled><app-icon name="check" [size]="14" />Plan actual</button>
                } @else {
                  <button class="btn primary" type="button" [disabled]="!canWrite()" (click)="changePlan(p)">
                    {{ s.status === 'canceled' ? 'Reactivar con este plan' : 'Cambiar a este plan' }}
                  </button>
                }
              </div>
            </article>
          }

          <section class="card bc span2">
            <div class="bc-t"><span>Datos de la empresa</span><small>Aparecen en tus facturas.</small></div>
            <form class="cform" (ngSubmit)="saveCompany()">
              <label class="fld">Razón social<input class="input" name="cn" [(ngModel)]="company.name" [disabled]="!canWrite()" /></label>
              <label class="fld">NIT<input class="input" name="ni" [(ngModel)]="company.nit" [disabled]="!canWrite()" /></label>
              <label class="fld">Correo<input class="input" type="email" name="ce" [(ngModel)]="company.email" [disabled]="!canWrite()" /></label>
              <label class="fld">Teléfono<input class="input" type="tel" name="cp" [(ngModel)]="company.phone" [disabled]="!canWrite()" /></label>
              <label class="fld">Ciudad<input class="input" name="cc" [(ngModel)]="company.city" [disabled]="!canWrite()" /></label>
              <label class="fld">Dirección<input class="input" name="ca" [(ngModel)]="company.address" [disabled]="!canWrite()" /></label>
              @if (canWrite()) {
                <div class="btns">
                  <button class="btn primary" type="submit" [disabled]="busy()">
                    @if (busy()) {
                      <app-icon name="refresh" [size]="14" class="spin" />
                    }
                    Guardar
                  </button>
                </div>
              }
            </form>
          </section>

          <section class="card bc">
            <div class="bc-t"><span>Cancelar suscripción</span></div>
            <p class="note">Tus datos se conservan; podrás reactivar cuando quieras.</p>
            @if (canWrite() && s.status !== 'canceled') {
              <div class="btns"><button class="btn" type="button" (click)="cancel()">Cancelar suscripción</button></div>
            }
          </section>
        </div>

        <div class="table-wrap" style="margin-top:18px">
          <div class="tt"><span>Facturas</span><small>{{ invoices().length }} {{ invoices().length === 1 ? 'factura' : 'facturas' }}</small></div>
          <table class="table grid" style="--cols: 110px minmax(0,1.6fr) 80px 100px 100px 110px minmax(0,1.4fr) 90px; min-width: 900px">
            <thead>
              <tr>
                <th>Número</th>
                <th>Periodo</th>
                <th>Plan</th>
                <th>Subtotal</th>
                <th>IVA 19 %</th>
                <th>Total</th>
                <th>Estado</th>
                <th class="actions-cell"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (i of invoices(); track i.id) {
                <tr>
                  <td data-label="Número"><b class="mono">{{ i.number }}</b></td>
                  <td data-label="Periodo">{{ i.periodStart | dt: 'short' }} – {{ i.periodEnd | dt: 'short' }}</td>
                  <td data-label="Plan">{{ i.planName }}</td>
                  <td data-label="Subtotal" class="tabular">{{ i.amountCop | cop }}</td>
                  <td data-label="IVA 19 %" class="tabular">{{ i.taxCop | cop }}</td>
                  <td data-label="Total" class="tabular" style="font-weight:600">{{ i.totalCop | cop }}</td>
                  <td data-label="Estado">
                    @if (i.status === 'paid') {
                      <span class="badge">Pagada {{ i.paidAt | dt: 'short' }}</span>
                    } @else if (i.status === 'pending') {
                      <span class="badge solid">Pendiente · vence {{ i.dueAt | dt: 'short' }}</span>
                    } @else {
                      <span class="badge off">Anulada</span>
                    }
                  </td>
                  <td class="actions-cell">
                    @if (i.status === 'pending' && canWrite()) {
                      <button class="btn sm icon" type="button" title="Pagar" aria-label="Pagar" (click)="pay(i)">
                        <app-icon name="credit-card" [size]="14" />
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="card"><div class="skeleton" style="height:120px"></div></div>
      }
    </div>

    <app-sheet
      [(open)]="companyOpen"
      title="Datos de la empresa"
      actionText="Guardar"
      [busy]="busy()"
      (action)="saveCompany()"
    >
      <form class="form-grid" (ngSubmit)="saveCompany()">
        <div class="field full">
          <label for="cn">Razón social</label
          ><input id="cn" class="input" name="cn" [(ngModel)]="company.name" />
        </div>
        <div class="field">
          <label for="ni">NIT</label
          ><input id="ni" class="input" name="ni" [(ngModel)]="company.nit" />
        </div>
        <div class="field">
          <label for="ce">Correo</label
          ><input id="ce" class="input" type="email" name="ce" [(ngModel)]="company.email" />
        </div>
        <div class="field">
          <label for="cp">Teléfono</label
          ><input id="cp" class="input" name="cp" [(ngModel)]="company.phone" />
        </div>
        <div class="field">
          <label for="cc">Ciudad</label
          ><input id="cc" class="input" name="cc" [(ngModel)]="company.city" />
        </div>
        <div class="field full">
          <label for="ca">Dirección</label
          ><input id="ca" class="input" name="ca" [(ngModel)]="company.address" />
        </div>
        <button type="submit" hidden></button>
      </form>
    </app-sheet>
  `,
  styles: `
    .banner { display: flex; align-items: center; gap: 10px; padding: 12px 14px; margin-bottom: 18px; border-radius: 14px; border: 1px solid var(--wms-border); background: var(--wms-input); font-size: 13px; text-wrap: pretty; }
    .bgrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
    .bgrid > * { animation: wms-in var(--dur-4) var(--ease) backwards; }
    .bgrid > :nth-child(1) { animation-delay: 120ms; } .bgrid > :nth-child(2) { animation-delay: 200ms; }
    .bgrid > :nth-child(3) { animation-delay: 280ms; } .bgrid > :nth-child(4) { animation-delay: 360ms; }
    .bgrid > :nth-child(5) { animation-delay: 440ms; } .bgrid > :nth-child(6) { animation-delay: 520ms; }
    /* Tarjeta genérica del prototipo (título 13/11 px, número 34 px, medidores 6 px, filas con divisor, botones al pie) */
    .bc { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .bc.full { grid-column: 1 / -1; }
    .bc.span2 { grid-column: span 2; }
    .bc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .bc-t { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .bc-t > span { font-size: 13px; font-weight: 600; }
    .bc-t small { font-size: 11px; color: var(--wms-muted); text-wrap: pretty; }
    .big { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
    .big b { font-size: 34px; line-height: 1; font-weight: 600; letter-spacing: -.035em; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .big small { font-size: 13px; color: var(--wms-muted); }
    .meter { display: flex; flex-direction: column; gap: 6px; }
    .mrow { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }
    .mrow span { color: var(--wms-muted); }
    .mrow b { font-weight: 600; font-variant-numeric: tabular-nums; }
    .track { height: 6px; border-radius: 999px; background: var(--wms-track); overflow: hidden; }
    .fill { height: 100%; background: var(--wms-bar-fill); border-radius: 999px; transform-origin: left; animation: grow var(--dur-5) var(--ease-out) .2s backwards; }
    .fill.warn { background: var(--wms-text); }
    @keyframes grow { from { transform: scaleX(0); } }
    .kv { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; padding: 8px 0; border-bottom: 1px solid var(--wms-divider); }
    .kv span { color: var(--wms-muted); }
    .kv b { font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
    .plan.current-plan { box-shadow: 0 0 0 2px var(--wms-text), var(--wms-card-shadow); }
    .plan ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
    .plan li { display: flex; gap: 10px; align-items: center; font-size: 13px; }
    .ck { flex: none; width: 18px; height: 18px; border-radius: 999px; border: 1px solid var(--wms-border); background: var(--wms-input); display: grid; place-items: center; color: var(--wms-text); }
    .cform { display: flex; flex-direction: column; gap: 12px; }
    .fld { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--wms-muted); }
    .fld .input { height: 38px; font-size: 13px; }
    .btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: auto; padding-top: 4px; }
    .btns .btn { flex: 1; height: 36px; border-radius: 10px; }
    .note { margin: 0; font-size: 12px; line-height: 1.5; color: var(--wms-muted); text-wrap: pretty; }
    .tt { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 10px 6px; }
    .tt span { font-size: 13px; font-weight: 600; }
    .tt small { font-size: 12px; color: var(--wms-muted); }
    @media (max-width: 1100px) {
      .bgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .bc.span2 { grid-column: 1 / -1; }
    }
    @media (max-width: 760px) {
      .bgrid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
    }
  `,
})
export class BillingPage implements OnInit {
  private api = inject(Api);
  readonly auth = inject(Auth);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  readonly sub = signal<Subscription | null>(null);
  readonly plans = signal<Plan[]>([]);
  readonly invoices = signal<Invoice[]>([]);
  readonly companyOpen = signal(false);
  readonly busy = signal(false);
  readonly status = STATUS;
  readonly canWrite = computed(() => this.auth.can('billing', 'write'));
  company: any = {};

  async ngOnInit() {
    await this.load();
  }

  async load() {
    try {
      const [s, p, i, c] = await Promise.all([
        this.api.get<Subscription>('subscription'),
        this.api.get<Plan[]>('plans'),
        this.api.get<Invoice[]>('invoices'),
        this.api.get<any>('company'),
      ]);
      this.sub.set(s);
      this.plans.set(p);
      this.invoices.set(i);
      this.company = { ...c };
    } catch (e) {
      this.toasts.error('No se pudo cargar la suscripción', errorMessage(e));
    }
  }

  private async refreshSession() {
    try {
      this.auth.updateUser(await this.api.get<Session>('auth/me'));
    } catch {}
  }

  /** RF25 – Cambiar (o reactivar) plan. */
  async changePlan(p: Plan) {
    const s = this.sub();
    const ok = await this.confirm.ask({
      title: `${s?.status === 'canceled' ? 'Reactivar' : 'Cambiar'} al plan ${p.name}`,
      message: `Se generará una factura de ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(p.priceCop * 1.19)} (IVA incluido) para el nuevo periodo.`,
      confirmText: 'Confirmar',
    });
    if (!ok) return;
    try {
      this.sub.set(await this.api.put<Subscription>('subscription/plan', { planCode: p.code }));
      this.toasts.success(`Plan ${p.name} activo`);
      await this.load();
      await this.refreshSession();
    } catch (e) {
      this.toasts.error('No se pudo cambiar el plan', errorMessage(e));
    }
  }

  /** RF26 – Cancelar suscripción. */
  async cancel() {
    const reason = await this.confirm.prompt({
      title: '¿Cancelar la suscripción?',
      message: 'Cuéntanos el motivo. Podrás reactivarla en cualquier momento.',
      confirmText: 'Cancelar suscripción',
      cancelText: 'Volver',
      destructive: true,
      input: { placeholder: 'Motivo de la cancelación' },
    });
    if (reason === null) return;
    try {
      this.sub.set(await this.api.post<Subscription>('subscription/cancel', { reason }));
      this.toasts.info('Suscripción cancelada', 'Tus datos se conservan.');
      await this.refreshSession();
    } catch (e) {
      this.toasts.error('No se pudo cancelar', errorMessage(e));
    }
  }

  async pay(i: Invoice) {
    const ok = await this.confirm.ask({
      title: `Pagar ${i.number}`,
      message:
        'Pago simulado (la pasarela real, p. ej. Wompi o PayU, está fuera del alcance del PPI).',
      confirmText: 'Pagar',
    });
    if (!ok) return;
    await this.api.post(`invoices/${i.id}/pay`);
    this.toasts.success('Pago registrado', i.number);
    await this.load();
  }

  async saveCompany() {
    this.busy.set(true);
    try {
      const { name, nit, email, phone, city, address } = this.company;
      await this.api.patch('company', { name, nit, email, phone, city, address });
      this.toasts.success('Datos actualizados');
      this.companyOpen.set(false);
      await this.refreshSession();
    } catch (e) {
      this.toasts.error('No se pudo guardar', errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
