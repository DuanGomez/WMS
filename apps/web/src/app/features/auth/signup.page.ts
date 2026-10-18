import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { CopPipe } from '../../core/format';
import { AuthResponse, Plan } from '../../core/models';
import { Toasts } from '../../core/ui.services';
import { IconComponent } from '../../ui/icon.component';
import { LogoComponent } from '../../ui/logo.component';
import { LangToggleComponent } from '../../ui/lang';
import { FlipCardDirective, FlipLinkDirective, ThemeToggleComponent, TiltDirective } from '../../ui/wms-fx';

/** RF23 / HU7 – Registro self-service de una empresa con su plan de suscripción. */
@Component({
  selector: 'app-signup',
  imports: [FormsModule, IconComponent, LogoComponent, CopPipe, TiltDirective, FlipCardDirective, FlipLinkDirective, ThemeToggleComponent, LangToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.scss',
  template: `
    <div class="a-bg"></div>
    <div class="a-glow-top"></div>
    <div class="a-glow-a"></div>
    <div class="a-glow-b"></div>
    <div class="auth-ctl"><app-lang-toggle /><app-theme-toggle [labeled]="true" /></div>
    <div class="auth-stage" [class.wide]="true">
      <div wmsTilt>
        <div wmsFlipCard>
          <section class="auth-card" wmsFlipFace aria-labelledby="t">
            <div class="hatch"></div>
            <div class="auth-head">
              <app-logo class="auth-logo" />
              <h1 class="auth-title" id="t">Crea tu cuenta</h1>
              <p class="auth-sub">Completa tus datos para empezar en WMS</p>
              <div class="steps" aria-hidden="true">
                <span [class.on]="step() >= 1"></span><span [class.on]="step() >= 2"></span
                ><span [class.on]="step() >= 3"></span>
              </div>
            </div>
            <form (ngSubmit)="next()" novalidate style="gap:14px">
              @switch (step()) {
                @case (1) {
                  <span class="sec">1. Elige tu plan</span>
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
                        <span class="pn">{{ p.name }}</span>
                        <span class="pp">{{ p.priceCop | cop }}<span> /mes</span></span>
                        <span class="pc">{{ p.maxVehicles }} vehículos · {{ p.maxUsers }} usuarios</span>
                      </button>
                    }
                  </div>
                }
                @case (2) {
                  <span class="sec">2. Datos de la empresa</span>
                  <div class="agrid">
                    <div class="afield full">
                      <label for="cn">Razón social</label>
                      <input id="cn" name="cn" [(ngModel)]="company.name" required placeholder="Supermercados la 72 S.A.S." />
                    </div>
                    <div class="afield">
                      <label for="nit">NIT</label>
                      <input id="nit" name="nit" [(ngModel)]="company.nit" placeholder="900123456-7" />
                    </div>
                    <div class="afield">
                      <label for="ph">Teléfono</label>
                      <input id="ph" name="ph" [(ngModel)]="company.phone" placeholder="604 444 7272" />
                    </div>
                    <div class="afield">
                      <label for="ce">Correo de la empresa</label>
                      <input id="ce" type="email" name="ce" [(ngModel)]="company.email" />
                    </div>
                    <div class="afield">
                      <label for="city">Ciudad</label>
                      <input id="city" name="city" [(ngModel)]="company.city" />
                    </div>
                  </div>
                }
                @case (3) {
                  <span class="sec">3. Responsable de la cuenta</span>
                  <div class="agrid">
                    <div class="afield full">
                      <label for="on">Nombre completo</label>
                      <input id="on" name="on" [(ngModel)]="owner.name" autocomplete="name" />
                    </div>
                    <div class="afield">
                      <label for="oe">Correo</label>
                      <input id="oe" type="email" name="oe" [(ngModel)]="owner.email" autocomplete="email" />
                    </div>
                    <div class="afield">
                      <label for="op">Contraseña</label>
                      <input id="op" type="password" name="op" [(ngModel)]="owner.password" autocomplete="new-password" />
                      <span class="hint">Mínimo 8 caracteres, con letras y números.</span>
                    </div>
                  </div>
                }
              }
              @if (error()) {
                <div class="form-error" role="alert">
                  <app-icon name="triangle-alert" [size]="16" /><span>{{ error() }}</span>
                </div>
              }
              <div class="row2" style="margin-top:6px">
                @if (step() > 1) {
                  <button class="abtn ghost" type="button" (click)="step.set(step() - 1)">Atrás</button>
                }
                <button class="abtn" type="submit" [disabled]="busy()">
                  @if (busy()) {
                    <span class="spinner"></span>
                  } @else {
                    <span>{{ step() < 3 ? 'Continuar' : 'Crear cuenta' }}</span><app-icon name="arrow-right" [size]="12" />
                  }
                </button>
              </div>
              <p class="alt">
                <span>¿Ya tienes cuenta?</span>
                <a wmsFlip="/login" href="/login">Inicia sesión</a>
              </p>
            </form>
          </section>
        </div>
      </div>
    </div>
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
