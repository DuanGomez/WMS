import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { IconComponent } from '../../ui/icon.component';
import { LogoComponent } from '../../ui/logo.component';

/** RF13 – Inicio de sesión. */
@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, IconComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.scss',
  template: `
    <section class="auth-card glass-thick" aria-labelledby="t">
      <app-logo class="auth-logo" />
      <h1 class="auth-title" id="t">WMS</h1>
      <p class="auth-sub">Monitoreo de tu flota en tiempo real</p>

      @if (motivo() === 'expired') {
        <p class="form-ok" style="margin-bottom:12px">Tu sesión expiró. Inicia sesión de nuevo.</p>
      }

      <form (ngSubmit)="submit()" #f="ngForm" novalidate>
        <div class="field">
          <label for="email">Correo electrónico</label>
          <input
            id="email"
            class="input"
            type="email"
            name="email"
            autocomplete="username"
            [(ngModel)]="email"
            required
            placeholder="tu@empresa.co"
          />
        </div>
        <div class="field">
          <label for="pw">Contraseña</label>
          <div class="pw">
            <input
              id="pw"
              class="input"
              [type]="show() ? 'text' : 'password'"
              name="password"
              autocomplete="current-password"
              [(ngModel)]="password"
              required
              placeholder="••••••••"
            />
            <button
              type="button"
              (click)="show.set(!show())"
              [attr.aria-label]="show() ? 'Ocultar contraseña' : 'Mostrar contraseña'"
            >
              <app-icon [name]="show() ? 'eye-off' : 'eye'" [size]="17" />
            </button>
          </div>
        </div>
        @if (error()) {
          <div class="form-error" role="alert">
            <app-icon name="triangle-alert" [size]="16" />{{ error() }}
          </div>
        }
        <button
          class="btn primary lg block"
          type="submit"
          [disabled]="busy() || !email || !password"
        >
          @if (busy()) {
            <app-icon name="refresh" [size]="18" class="spin" />
          }
          Iniciar sesión
        </button>
        <div class="links">
          <a routerLink="/recuperar">¿Olvidaste tu contraseña?</a>
          <a routerLink="/registro">Registrar mi empresa</a>
        </div>
      </form>

      <div class="demo">
        <p class="caption">Cuentas demo · contraseña <strong class="mono">Demo1234!</strong></p>
        <div class="chips">
          @for (d of demos; track d.email) {
            <button type="button" class="chip" (click)="fill(d.email)">{{ d.label }}</button>
          }
        </div>
      </div>
      <p class="foot">Tecnológico de Antioquia · Ingeniería de Software II</p>
    </section>
  `,
})
export class LoginPage {
  private auth = inject(Auth);
  private router = inject(Router);
  readonly motivo = input<string>();
  email = '';
  password = '';
  readonly show = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly demos = [
    { label: 'Administrador', email: 'admin@la72.co' },
    { label: 'Responsable', email: 'gerencia@la72.co' },
    { label: 'Supervisor', email: 'supervisor@la72.co' },
    { label: 'Conductor', email: 'conductor@la72.co' },
    { label: 'Otra empresa', email: 'admin@eltrigal.co' },
    { label: 'Soporte', email: 'soporte@wms.co' },
  ];

  fill(email: string) {
    this.email = email;
    this.password = 'Demo1234!';
    this.error.set('');
  }

  async submit() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.login(this.email.trim(), this.password);
      await this.router.navigateByUrl(this.auth.home());
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
