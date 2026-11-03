import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { AuthResponse } from '../../core/models';
import { IconComponent } from '../../ui/icon.component';
import { LogoComponent } from '../../ui/logo.component';
import { LangToggleComponent } from '../../ui/lang';
import { ThemeToggleComponent } from '../../ui/wms-fx';

interface JoinInfo {
  code: string;
  company: string;
  label: string;
  expiresAt: string | null;
}

/**
 * «Únete como conductor»: se abre desde el enlace o el código QR de una invitación. La persona crea su cuenta con
 * su celular y entra a Mi turno, donde comparte su ubicación en vivo con la empresa.
 */
@Component({
  selector: 'app-join',
  imports: [FormsModule, RouterLink, IconComponent, LogoComponent, ThemeToggleComponent, LangToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth.scss',
  template: `
    <div class="a-bg"></div>
    <div class="a-glow-top"></div>
    <div class="a-glow-a"></div>
    <div class="a-glow-b"></div>
    <div class="auth-ctl"><app-lang-toggle /><app-theme-toggle [labeled]="true" /></div>
    <main class="auth-stage">
      <section class="auth-card" aria-labelledby="t">
        <div class="hatch"></div>
        <div class="auth-head">
          <app-logo class="auth-logo" />
          @if (info(); as i) {
            <h1 class="auth-title" id="t">Únete como conductor</h1>
            <p class="auth-sub">
              <b>{{ i.company }}</b> te invita a WMS{{ i.label ? ' · ' + i.label : '' }}. Crea tu cuenta y comparte la
              ubicación de tu celular en el mapa en vivo.
            </p>
          } @else if (invalid()) {
            <h1 class="auth-title" id="t">Invitación no válida</h1>
            <p class="auth-sub">{{ invalid() }}</p>
          } @else {
            <h1 class="auth-title" id="t">Cargando invitación…</h1>
          }
        </div>

        @if (info()) {
          <form (ngSubmit)="submit()" novalidate style="gap:14px">
            <div class="agrid">
              <div class="afield full">
                <label for="jn">Nombre completo</label>
                <input id="jn" name="jn" [(ngModel)]="form.name" autocomplete="name" required />
              </div>
              <div class="afield">
                <label for="jp">Celular</label>
                <input id="jp" name="jp" type="tel" inputmode="tel" [(ngModel)]="form.phone" autocomplete="tel" required />
              </div>
              <div class="afield">
                <label for="je">Correo</label>
                <input id="je" name="je" type="email" inputmode="email" [(ngModel)]="form.email" autocomplete="email" required />
              </div>
              <div class="afield full">
                <label for="jw">Contraseña</label>
                <input id="jw" name="jw" type="password" [(ngModel)]="form.password" autocomplete="new-password" required />
                <span class="hint">Mínimo 8 caracteres, con letras y números. La usarás para volver a entrar.</span>
              </div>
            </div>
            <p class="join-note">
              <app-icon name="map-pin" [size]="14" />
              <span>Al entrar, tu navegador te pedirá permiso para usar la ubicación. Tu empresa solo la ve mientras la compartes y puedes pausarla cuando quieras en <b>Mi turno</b>.</span>
            </p>
            @if (error()) {
              <div class="form-error" role="alert">
                <app-icon name="triangle-alert" [size]="16" /><span>{{ error() }}</span>
              </div>
            }
            <button class="abtn" type="submit" [disabled]="busy()">
              @if (busy()) {
                <span class="spinner"></span>
              } @else {
                <span>Crear cuenta y entrar</span><app-icon name="arrow-right" [size]="12" />
              }
            </button>
            <p class="alt">
              <span>¿Ya tienes cuenta?</span>
              <a routerLink="/login">Inicia sesión</a>
            </p>
          </form>
        } @else if (invalid()) {
          <a class="abtn" routerLink="/login"><span>Ir a iniciar sesión</span><app-icon name="arrow-right" [size]="12" /></a>
        } @else {
          <div class="skeleton" style="height:180px;border-radius:14px"></div>
        }
      </section>
    </main>
  `,
  styles: `
    .join-note { display: flex; gap: 8px; align-items: flex-start; margin: 0; font-size: 12px; line-height: 1.5; color: var(--wms-muted); }
    .join-note app-icon { flex: none; margin-top: 2px; }
    a.abtn { text-decoration: none; }
  `,
})
export class JoinPage implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);
  private router = inject(Router);
  readonly code = input<string>('');
  readonly info = signal<JoinInfo | null>(null);
  readonly invalid = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  form = { name: '', phone: '', email: '', password: '' };

  async ngOnInit() {
    try {
      this.info.set(await this.api.get<JoinInfo>(`join/${encodeURIComponent(this.code())}`));
    } catch {
      this.invalid.set('El enlace venció, alcanzó su cupo o fue desactivado. Pídele uno nuevo a quien te invitó.');
    }
  }

  async submit() {
    this.error.set('');
    if (!this.form.name.trim() || !this.form.phone.trim() || !this.form.email.trim() || !this.form.password) {
      return this.error.set('Completa todos los campos.');
    }
    this.busy.set(true);
    try {
      const r = await this.api.post<AuthResponse>(`join/${encodeURIComponent(this.code())}`, this.form);
      this.auth.setSession(r);
      await this.router.navigateByUrl('/mi-turno');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
