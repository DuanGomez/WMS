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

const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: 'Activa', tone: 'green' },
  trialing: { label: 'Prueba', tone: 'blue' },
  past_due: { label: 'Pago pendiente', tone: 'orange' },
  canceled: { label: 'Cancelada', tone: 'red' },
};

/** RG7 / RE9 / RF23-RF26 – Plan de suscripción, uso, facturas y datos de la empresa. */
@Component({
  selector: 'app-billing',
  imports: [FormsModule, IconComponent, SheetComponent, CopPipe, DtPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="eyebrow">{{ auth.user()?.company?.name }}</div>
          <h1 class="large-title">Suscripción y facturación</h1>
        </div>
        <div class="actions">
          @if (canWrite()) {
            <button class="btn" type="button" (click)="companyOpen.set(true)">
              <app-icon name="building" [size]="16" />Datos de la empresa
            </button>
          }
        </div>
      </header>

      @if (sub(); as s) {
        <section class="card current">
          <div class="row wrap" style="align-items:flex-start">
            <div style="flex:1;min-width:240px">
              <div class="row">
                <span class="caption">Plan actual</span
                ><span class="badge" [class]="'badge ' + status[s.status].tone">{{
                  status[s.status].label
                }}</span>
              </div>
              <h2 class="title-1">{{ s.plan.name }}</h2>
              <div class="title-3 tabular">
                {{ s.plan.priceCop | cop }} <span class="footnote">/ mes + IVA</span>
              </div>
              @if (s.status === 'canceled') {
                <p class="footnote" style="margin-top:6px">
                  Cancelada el {{ s.canceledAt | dt: 'date' }}. Motivo: {{ s.cancelReason }}. Puedes
                  consultar tus datos, pero no crear registros hasta reactivar un plan.
                </p>
              } @else {
                <p class="footnote" style="margin-top:6px">
                  Periodo actual: {{ s.currentPeriodStart | dt: 'date' }} –
                  {{ s.currentPeriodEnd | dt: 'date' }} · Cliente desde
                  {{ s.startedAt | dt: 'date' }}
                </p>
              }
            </div>
            <div class="usage">
              <div class="meter">
                <div class="row">
                  <span>Vehículos</span><span class="spacer"></span
                  ><strong class="tabular"
                    >{{ s.usage.vehicles }} / {{ s.plan.maxVehicles }}</strong
                  >
                </div>
                <div class="track">
                  <div
                    class="fill"
                    [class.warn]="s.usage.vehicles / s.plan.maxVehicles > 0.8"
                    [style.width.%]="(s.usage.vehicles / s.plan.maxVehicles) * 100"
                  ></div>
                </div>
              </div>
              <div class="meter">
                <div class="row">
                  <span>Usuarios</span><span class="spacer"></span
                  ><strong class="tabular">{{ s.usage.users }} / {{ s.plan.maxUsers }}</strong>
                </div>
                <div class="track">
                  <div
                    class="fill"
                    [class.warn]="s.usage.users / s.plan.maxUsers > 0.8"
                    [style.width.%]="(s.usage.users / s.plan.maxUsers) * 100"
                  ></div>
                </div>
              </div>
              <div class="caption">{{ s.usage.devices }} dispositivos GPS registrados</div>
            </div>
          </div>
        </section>

        <h2 class="title-2" style="margin:28px 0 12px">Planes</h2>
        <div class="grid grid-3">
          @for (p of plans(); track p.code) {
            <article
              class="card plan"
              [class.current-plan]="p.code === s.plan.code && s.status !== 'canceled'"
            >
              @if (p.code === 'pro') {
                <span class="badge blue ribbon">Más elegido</span>
              }
              <h3 class="title-3">{{ p.name }}</h3>
              <p class="footnote" style="min-height:38px">{{ p.description }}</p>
              <div class="price tabular">
                {{ p.priceCop | cop }}<span class="footnote"> /mes</span>
              </div>
              <ul>
                @for (f of p.features; track f) {
                  <li><app-icon name="check" [size]="14" class="c-green" />{{ f }}</li>
                }
              </ul>
              @if (p.code === s.plan.code && s.status !== 'canceled') {
                <button class="btn block" type="button" disabled>Plan actual</button>
              } @else if (canWrite()) {
                <button class="btn primary block" type="button" (click)="changePlan(p)">
                  {{ s.status === 'canceled' ? 'Reactivar con ' : 'Cambiar a ' }}{{ p.name }}
                </button>
              }
            </article>
          }
        </div>

        <h2 class="title-2" style="margin:28px 0 12px">Facturas</h2>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Número</th>
                <th>Periodo</th>
                <th>Plan</th>
                <th class="num">Subtotal</th>
                <th class="num">IVA 19 %</th>
                <th class="num">Total</th>
                <th>Estado</th>
                <th class="actions-cell"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (i of invoices(); track i.id) {
                <tr>
                  <td class="mono">{{ i.number }}</td>
                  <td class="caption">
                    {{ i.periodStart | dt: 'date' }} – {{ i.periodEnd | dt: 'date' }}
                  </td>
                  <td>{{ i.planName }}</td>
                  <td class="num">{{ i.amountCop | cop }}</td>
                  <td class="num">{{ i.taxCop | cop }}</td>
                  <td class="num" style="font-weight:600">{{ i.totalCop | cop }}</td>
                  <td>
                    @if (i.status === 'paid') {
                      <span class="badge green">Pagada {{ i.paidAt | dt: 'date' }}</span>
                    } @else if (i.status === 'pending') {
                      <span class="badge orange">Pendiente · vence {{ i.dueAt | dt: 'date' }}</span>
                    } @else {
                      <span class="badge">Anulada</span>
                    }
                  </td>
                  <td class="actions-cell">
                    @if (i.status === 'pending' && canWrite()) {
                      <button class="btn sm primary" type="button" (click)="pay(i)">
                        <app-icon name="credit-card" [size]="14" />Pagar
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (canWrite() && s.status !== 'canceled') {
          <div class="card danger-zone">
            <div style="flex:1">
              <div class="headline">Cancelar suscripción</div>
              <p class="footnote">Tus datos se conservan; podrás reactivar cuando quieras.</p>
            </div>
            <button class="btn danger" type="button" (click)="cancel()">
              Cancelar suscripción
            </button>
          </div>
        }
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
    .current {
      padding: 22px 24px;
    }
    .usage {
      width: min(340px, 100%);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .meter .row {
      font-size: 14px;
      margin-bottom: 6px;
    }
    .track {
      height: 8px;
      border-radius: 4px;
      background: var(--fill-2);
      overflow: hidden;
    }
    .fill {
      height: 100%;
      background: var(--blue);
      border-radius: 4px;
      transition: width 600ms var(--ease);
    }
    .fill.warn {
      background: var(--orange);
    }
    .plan {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .plan.current-plan {
      box-shadow:
        0 0 0 2px var(--tint),
        var(--shadow-2);
    }
    .plan .price {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.03em;
    }
    .plan ul {
      list-style: none;
      padding: 0;
      margin: 8px 0 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 14px;
      flex: 1;
    }
    .plan li {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .ribbon {
      position: absolute;
      top: 16px;
      right: 16px;
    }
    .danger-zone {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-top: 28px;
      flex-wrap: wrap;
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
