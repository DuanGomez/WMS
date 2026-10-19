import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { IconComponent } from '../../ui/icon.component';
import { LogoComponent } from '../../ui/logo.component';
import { LangToggleComponent } from '../../ui/lang';
import { FlipCardDirective, ThemeToggleComponent, TiltDirective } from '../../ui/wms-fx';

/** RF27 – Recuperar contraseña olvidada. */
@Component({
  selector: 'app-forgot',
  imports: [FormsModule, RouterLink, IconComponent, LogoComponent, TiltDirective, FlipCardDirective, ThemeToggleComponent, LangToggleComponent],
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
              <h1 class="auth-title" id="t">Recuperar contraseña</h1>
              <p class="auth-sub">Te enviaremos un enlace para crear una nueva.</p>
            </div>
            <form (ngSubmit)="submit()" novalidate>
              <div class="ifield">
                <app-icon name="mail" [size]="16" />
                <input
                  id="email"
                  type="email"
                  name="email"
                  [(ngModel)]="email"
                  autocomplete="email"
                  required
                  placeholder="Correo electrónico"
                  aria-label="Correo electrónico"
                />
              </div>
              @if (error()) {
                <div class="form-error" role="alert">
                  <app-icon name="triangle-alert" [size]="16" /><span>{{ error() }}</span>
                </div>
              }
              @if (message()) {
                <div class="form-ok" role="status">
                  <span class="ok-ic"><app-icon name="check" [size]="11" /></span>
                  <span style="flex:1;min-width:0">{{ message() }}</span>
                  @if (demoPath()) {
                    <div style="flex-basis:100%;margin-top:4px;color:var(--wms-muted)">
                      <strong style="color:var(--wms-text)">Modo demo:</strong> el correo se simula en la bandeja de notificaciones.
                      <a [routerLink]="'/restablecer'" [queryParams]="{ token: token() }">Abrir el enlace de restablecimiento →</a>
                    </div>
                  }
                </div>
              }
              <button class="abtn" type="submit" [disabled]="busy() || !email">
                @if (busy()) {
                  <span class="spinner"></span>
                } @else {
                  <span>Enviar enlace</span><app-icon name="arrow-right" [size]="12" />
                }
              </button>
              <p class="alt"><a class="muted" routerLink="/login">Volver a iniciar sesión</a></p>
            </form>
          </section>
        </div>
      </div>
    </div>
  `,
})
export class ForgotPage {
  private api = inject(Api);
  email = '';
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly demoPath = signal('');
  readonly token = signal('');

  async submit() {
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await this.api.post<{ message: string; demoResetPath?: string }>(
        'auth/forgot-password',
        { email: this.email },
      );
      this.message.set(r.message);
      if (r.demoResetPath) {
        this.demoPath.set(r.demoResetPath);
        this.token.set(new URLSearchParams(r.demoResetPath.split('?')[1]).get('token') ?? '');
      }
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
