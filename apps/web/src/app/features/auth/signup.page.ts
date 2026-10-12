import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { CopPipe } from '../../core/format';
import { AuthResponse, Plan } from '../../core/models';
import { Toasts } from '../../core/ui.services';
import { IconComponent } from '../../ui/icon.component';
import { LogoComponent } from '../../ui/logo.component';

/** RF23 / HU7 – Registro self-service de una empresa con su plan de suscripción. */
@Component({
  selector: 'app-signup',
  imports: [FormsModule, RouterLink, IconComponent, LogoComponent, CopPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.scss',
  template: `
    <section class="auth-card wide glass-thick" aria-labelledby="t">
      <app-logo class="auth-logo" [size]="56" style="width:56px;height:56px" />
      <h1 class="auth-title" id="t">Registra tu empresa</h1>
      <p class="auth-sub">Empieza a monitorear tu flota en minutos, sin contratos largos.</p>
      <div class="steps" aria-hidden="true">
        <span [class.on]="step() >= 1"></span><span [class.on]="step() >= 2"></span
        ><span [class.on]="step() >= 3"></span>
      </div>

      <form (ngSubmit)="next()" novalidate>
        @switch (step()) {
          @case (1) {
            <h2 class="headline">1. Elige tu plan</h2>
            <div class="plans" role="radiogroup" aria-label="Planes">
              @for (p of plans(); track p.code) {
                <button
                  type="button"
                  class="plan"
                  role="radio"
                  [attr.aria-checked]="planCode === p.code"
                  [class.selected]="planCode === p.code"
                  (click)="planCode = p.code"
                >
                  <div class="headline">{{ p.name }}</div>
                  <div class="price tabular">
                    {{ p.priceCop | cop }}<span class="caption"> /mes</span>
                  </div>
                  <div class="caption">
                    Hasta {{ p.maxVehicles }} vehículos · {{ p.maxUsers }} usuarios
                  </div>
                </button>
              }
            </div>
          }
          @case (2) {
            <h2 class="headline">2. Datos de la empresa</h2>
            <div class="form-grid">
              <div class="field full">
                <label for="cn">Razón social</label
                ><input
                  id="cn"
                  class="input"
                  name="cn"
                  [(ngModel)]="company.name"
                  required
                  placeholder="Supermercados la 72 S.A.S."
                />
              </div>
              <div class="field">
                <label for="nit">NIT</label
                ><input
                  id="nit"
                  class="input"
                  name="nit"
                  [(ngModel)]="company.nit"
                  placeholder="900123456-7"
                />
              </div>
              <div class="field">
                <label for="ph">Teléfono</label
                ><input
                  id="ph"
                  class="input"
                  name="ph"
                  [(ngModel)]="company.phone"
                  placeholder="604 444 7272"
                />
              </div>
              <div class="field">
                <label for="ce">Correo de la empresa</label
                ><input id="ce" class="input" type="email" name="ce" [(ngModel)]="company.email" />
              </div>
              <div class="field">
                <label for="city">Ciudad</label
                ><input id="city" class="input" name="city" [(ngModel)]="company.city" />
              </div>
            </div>
          }
          @case (3) {
            <h2 class="headline">3. Responsable de la cuenta</h2>
            <div class="form-grid">
              <div class="field full">
                <label for="on">Nombre completo</label
                ><input
                  id="on"
                  class="input"
                  name="on"
                  [(ngModel)]="owner.name"
                  autocomplete="name"
                />
              </div>
              <div class="field">
                <label for="oe">Correo</label
                ><input
                  id="oe"
                  class="input"
                  type="email"
                  name="oe"
                  [(ngModel)]="owner.email"
                  autocomplete="email"
                />
              </div>
              <div class="field">
                <label for="op">Contraseña</label>
                <input
                  id="op"
                  class="input"
                  type="password"
                  name="op"
                  [(ngModel)]="owner.password"
                  autocomplete="new-password"
                />
                <span class="hint">Mínimo 8 caracteres, con letras y números.</span>
              </div>
            </div>
          }
        }
        @if (error()) {
          <div class="form-error" role="alert">
            <app-icon name="triangle-alert" [size]="16" />{{ error() }}
          </div>
        }
        <div class="row" style="margin-top:6px">
          @if (step() > 1) {
            <button class="btn lg" type="button" (click)="step.set(step() - 1)">Atrás</button>
          }
          <button class="btn primary lg" style="flex:1" type="submit" [disabled]="busy()">
            @if (busy()) {
              <app-icon name="refresh" [size]="18" class="spin" />
            }
            {{ step() < 3 ? 'Continuar' : 'Crear cuenta' }}
          </button>
        </div>
        <div class="links" style="justify-content:center">
          <a routerLink="/login">Ya tengo cuenta</a>
        </div>
      </form>
    </section>
  `,
})
export class SignupPage implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);
  private router = inject(Router);
  private toasts = inject(Toasts);
  readonly plans = signal<Plan[]>([]);
  readonly step = signal(1);
  readonly busy = signal(false);
  readonly error = signal('');
  planCode = 'pro';
  company = { name: '', nit: '', phone: '', email: '', city: 'Medellín' };
  owner = { name: '', email: '', password: '' };

  async ngOnInit() {
    this.plans.set(await this.api.get<Plan[]>('plans'));
  }

  async next() {
    this.error.set('');
    if (
      this.step() === 2 &&
      (!this.company.name || !this.company.nit || !this.company.email || !this.company.phone)
    ) {
      return this.error.set('Completa todos los datos de la empresa.');
    }
    if (this.step() < 3) return this.step.set(this.step() + 1);
    this.busy.set(true);
    try {
      const r = await this.api.post<AuthResponse>('companies/signup', {
        company: this.company,
        owner: this.owner,
        planCode: this.planCode,
      });
      this.auth.setSession(r);
      this.toasts.success(
        '¡Bienvenido a WMS!',
        'Tu empresa quedó registrada. Empieza creando tu primer vehículo.',
      );
      await this.router.navigateByUrl('/inicio');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
