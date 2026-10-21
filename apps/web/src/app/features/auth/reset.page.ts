import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { Toasts } from '../../core/ui.services';
import { IconComponent } from '../../ui/icon.component';
import { LogoComponent } from '../../ui/logo.component';
import { LangToggleComponent } from '../../ui/lang';
import { FlipCardDirective, ThemeToggleComponent, TiltDirective } from '../../ui/wms-fx';

/** RF27 – Crear nueva contraseña desde el enlace de recuperación. */
@Component({
  selector: 'app-reset',
  imports: [FormsModule, RouterLink, IconComponent, LogoComponent, TiltDirective, FlipCardDirective, ThemeToggleComponent, LangToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.scss',
  template: `
    <div class="a-bg"></div>
    <div class="a-glow-top"></div>
    <div class="a-glow-a"></div>
    <div class="a-glow-b"></div>
    <div class="auth-ctl"><app-lang-toggle /><app-theme-toggle [labeled]="true" /></div>
    <main class="auth-stage">
      <div wmsTilt>
        <div wmsFlipCard>
          <section class="auth-card" aria-labelledby="t">
            <div class="hatch"></div>
            <div class="auth-head">
              <app-logo class="auth-logo" />
              <h1 class="auth-title" id="t">Nueva contraseña</h1>
              <p class="auth-sub">Mínimo 8 caracteres, con letras y números.</p>
            </div>
            <form (ngSubmit)="submit()" novalidate>
              <div class="fields">
                <div class="ifield">
                  <app-icon name="lock" [size]="16" />
                  <input id="p1" type="password" name="p1" [(ngModel)]="p1" autocomplete="new-password" placeholder="Nueva contraseña" aria-label="Nueva contraseña" />
                </div>
                <div class="ifield">
                  <app-icon name="lock" [size]="16" />
                  <input id="p2" type="password" name="p2" [(ngModel)]="p2" autocomplete="new-password" placeholder="Confirmar contraseña" aria-label="Confirmar contraseña" />
                </div>
              </div>
              @if (!token()) {
                <div class="form-error"><app-icon name="triangle-alert" [size]="16" /><span>El enlace no contiene un token válido.</span></div>
              }
              @if (error()) {
                <div class="form-error" role="alert">
                  <app-icon name="triangle-alert" [size]="16" /><span>{{ error() }}</span>
                </div>
              }
              <button class="abtn" type="submit" [disabled]="busy() || !token()">
                @if (busy()) {
                  <span class="spinner"></span>
                } @else {
                  <span>Guardar contraseña</span><app-icon name="arrow-right" [size]="12" />
                }
              </button>
              <p class="alt"><a class="muted" routerLink="/login">Volver a iniciar sesión</a></p>
            </form>
          </section>
        </div>
      </div>
    </main>
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
