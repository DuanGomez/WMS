import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { Toasts } from '../../core/ui.services';
import { IconComponent } from '../../ui/icon.component';
import { LogoComponent } from '../../ui/logo.component';

/** RF27 – Crear nueva contraseña desde el enlace de recuperación. */
@Component({
  selector: 'app-reset',
  imports: [FormsModule, RouterLink, IconComponent, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.scss',
  template: `
    <section class="auth-card glass-thick" aria-labelledby="t">
      <app-logo class="auth-logo" />
      <h1 class="auth-title" id="t">Nueva contraseña</h1>
      <p class="auth-sub">Mínimo 8 caracteres, con letras y números.</p>
      <form (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="p1">Nueva contraseña</label>
          <input
            id="p1"
            class="input"
            type="password"
            name="p1"
            [(ngModel)]="p1"
            autocomplete="new-password"
          />
        </div>
        <div class="field">
          <label for="p2">Confirmar contraseña</label>
          <input
            id="p2"
            class="input"
            type="password"
            name="p2"
            [(ngModel)]="p2"
            autocomplete="new-password"
          />
        </div>
        @if (!token()) {
          <div class="form-error">El enlace no contiene un token válido.</div>
        }
        @if (error()) {
          <div class="form-error" role="alert">
            <app-icon name="triangle-alert" [size]="16" />{{ error() }}
          </div>
        }
        <button class="btn primary lg block" type="submit" [disabled]="busy() || !token()">
          Guardar contraseña
        </button>
        <div class="links" style="justify-content:center">
          <a routerLink="/login">Volver a iniciar sesión</a>
        </div>
      </form>
    </section>
  `,
})
export class ResetPage {
  private api = inject(Api);
  private router = inject(Router);
  private toasts = inject(Toasts);
  readonly token = input<string>('');
  p1 = '';
  p2 = '';
  readonly busy = signal(false);
  readonly error = signal('');

  async submit() {
    if (this.p1 !== this.p2) return this.error.set('Las contraseñas no coinciden.');
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await this.api.post<{ message: string }>('auth/reset-password', {
        token: this.token(),
        newPassword: this.p1,
      });
      this.toasts.success('Contraseña actualizada', r.message);
      await this.router.navigateByUrl('/login');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
