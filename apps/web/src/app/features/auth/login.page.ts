import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { IconComponent } from '../../ui/icon.component';
import { LogoComponent } from '../../ui/logo.component';
import { LangToggleComponent } from '../../ui/lang';
import { FlipCardDirective, FlipLinkDirective, ThemeToggleComponent, TiltDirective } from '../../ui/wms-fx';

/** RF13 – Inicio de sesión. */
@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, IconComponent, LogoComponent, TiltDirective, FlipCardDirective, FlipLinkDirective, ThemeToggleComponent, LangToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.scss',
  template: `
    <div class="a-bg"></div>
    <div class="a-glow-top"></div>
    <div class="a-glow-a"></div>
    <div class="a-glow-b"></div>
    <div class="auth-ctl"><app-lang-toggle /><app-theme-toggle [labeled]="true" /></div>
    <div class="auth-stage">
      <div wmsTilt>
        <div wmsFlipCard>
          <section class="auth-card" wmsFlipFace aria-labelledby="t">
            <div class="hatch"></div>
            <div class="auth-head">
              <app-logo class="auth-logo" />
              <h1 class="auth-title" id="t">Bienvenido de nuevo</h1>
              <p class="auth-sub">Inicia sesión para continuar</p>
            </div>
            @if (motivo() === 'expired') {
              <div class="form-ok" style="margin-bottom:16px" role="status">
                <span class="ok-ic"><app-icon name="info" [size]="11" /></span>
                <span>Tu sesión expiró. Inicia sesión de nuevo.</span>
              </div>
            }
            <form (ngSubmit)="submit()" #f="ngForm" novalidate>
              <div class="fields">
                <div class="ifield">
                  <app-icon name="mail" [size]="16" />
                  <input
                    id="email"
                    type="email"
                    name="email"
                    autocomplete="username"
                    [(ngModel)]="email"
                    required
                    placeholder="Correo electrónico"
                    aria-label="Correo electrónico"
                  />
                </div>
                <div class="ifield pw">
                  <app-icon name="lock" [size]="16" />
                  <input
                    id="pw"
                    [type]="show() ? 'text' : 'password'"
                    name="password"
                    autocomplete="current-password"
                    [(ngModel)]="password"
                    required
                    placeholder="Contraseña"
                    aria-label="Contraseña"
                  />
                  <button
                    type="button"
                    class="eye"
                    (click)="show.set(!show())"
                    [attr.aria-label]="show() ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                  >
                    <app-icon [name]="show() ? 'eye' : 'eye-closed'" [size]="16" />
                  </button>
                </div>
              </div>
              <div class="right"><a routerLink="/recuperar">¿Olvidaste tu contraseña?</a></div>
              @if (error()) {
                <div class="form-error" role="alert" style="margin-bottom:-12px">
                  <app-icon name="triangle-alert" [size]="16" /><span>{{ error() }}</span>
                </div>
              }
              <button class="abtn top" type="submit" [disabled]="busy()">
                @if (busy()) {
                  <span class="spinner"></span>
                } @else {
                  <span>Iniciar sesión</span><app-icon name="arrow-right" [size]="12" />
                }
              </button>
              <p class="alt">
                <span>¿No tienes cuenta?</span>
                <a wmsFlip="/registro" href="registro">Regístrate</a>
              </p>
            </form>
            <div class="demo">
              <p>Cuentas demo · contraseña <strong>Demo1234!</strong></p>
              <div class="chips">
                @for (d of demos; track d.email) {
                  <button type="button" class="chip" (click)="fill(d.email)">{{ d.label }}</button>
                }
              </div>
            </div>
            <p class="foot">Tecnológico de Antioquia · Ingeniería de Software II</p>
          </section>
        </div>
      </div>
    </div>
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
    // Prototipo: el botón siempre está activo; sin datos se muestra el error de acceso
    if (!this.email.trim() || !this.password) {
      this.error.set('');
      queueMicrotask(() => this.error.set('Correo o contraseña incorrectos.'));
      return;
    }
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
