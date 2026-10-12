import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { IconComponent } from '../../ui/icon.component';
import { LogoComponent } from '../../ui/logo.component';

/** RF27 – Recuperar contraseña olvidada. */
@Component({
  selector: 'app-forgot',
  imports: [FormsModule, RouterLink, IconComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.scss',
  template: `
    <section class="auth-card glass-thick" aria-labelledby="t">
      <app-logo class="auth-logo" />
      <h1 class="auth-title" id="t">Recuperar contraseña</h1>
      <p class="auth-sub">Te enviaremos un enlace para crear una nueva.</p>
      <form (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="email">Correo electrónico</label>
          <input
            id="email"
            class="input"
            type="email"
            name="email"
            [(ngModel)]="email"
            autocomplete="email"
            required
          />
        </div>
        @if (error()) {
          <div class="form-error" role="alert">
            <app-icon name="triangle-alert" [size]="16" />{{ error() }}
          </div>
        }
        @if (message()) {
          <div class="form-ok" role="status">
            {{ message() }}
            @if (demoPath()) {
              <div style="margin-top:8px">
                <strong>Modo demo:</strong> el correo se simula en la bandeja de notificaciones.
                <a [routerLink]="'/restablecer'" [queryParams]="{ token: token() }"
                  >Abrir el enlace de restablecimiento →</a
                >
              </div>
            }
          </div>
        }
        <button class="btn primary lg block" type="submit" [disabled]="busy() || !email">
          Enviar enlace
        </button>
        <div class="links" style="justify-content:center">
          <a routerLink="/login">Volver a iniciar sesión</a>
        </div>
      </form>
    </section>
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
