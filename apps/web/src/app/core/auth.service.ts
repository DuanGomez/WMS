import {
  HttpBackend,
  HttpClient,
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, firstValueFrom, from, switchMap, throwError } from 'rxjs';
import { AuthResponse, Level, Module, Session } from './models';

const KEY = 'wms.session';

interface Stored {
  accessToken: string;
  refreshToken: string;
  user: Session;
}

/** Sesión del usuario (JWT de acceso + refresh rotativo) como signals. */
@Injectable({ providedIn: 'root' })
export class Auth {
  /** HttpClient sin interceptores para evitar ciclos al renovar el token. */
  private raw = new HttpClient(inject(HttpBackend));
  private router = inject(Router);
  private state = signal<Stored | null>(this.load());
  private refreshing: Promise<string | null> | null = null;

  readonly user = computed(() => this.state()?.user ?? null);
  readonly isLoggedIn = computed(() => !!this.state());
  readonly accessToken = () => this.state()?.accessToken ?? null;

  private load(): Stored | null {
    try {
      const v = localStorage.getItem(KEY);
      return v ? (JSON.parse(v) as Stored) : null;
    } catch {
      return null;
    }
  }

  private save(s: Stored | null) {
    this.state.set(s);
    try {
      if (s) localStorage.setItem(KEY, JSON.stringify(s));
      else localStorage.removeItem(KEY);
    } catch {}
  }

  setSession(r: AuthResponse) {
    this.save({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user });
  }

  updateUser(user: Session) {
    const s = this.state();
    if (s) this.save({ ...s, user });
  }

  async login(email: string, password: string) {
    const r = await firstValueFrom(
      this.raw.post<AuthResponse>('/api/auth/login', { email, password }),
    );
    this.setSession(r);
    return r.user;
  }

  /** Renueva el access token (una sola petición aunque varias lleguen a la vez). */
  refresh(): Promise<string | null> {
    if (this.refreshing) return this.refreshing;
    const s = this.state();
    if (!s) return Promise.resolve(null);
    this.refreshing = firstValueFrom(
      this.raw.post<AuthResponse>('/api/auth/refresh', { refreshToken: s.refreshToken }),
    )
      .then((r) => {
        this.setSession(r);
        return r.accessToken;
      })
      .catch((e) => {
        // Sólo cerramos sesión si el servidor rechazó el refresh (no por un corte de red).
        if (e instanceof HttpErrorResponse && e.status === 401) this.clear('expired');
        return null;
      })
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  /** RF14: cierre de sesión seguro (invalida el refresh token en el servidor). */
  async logout() {
    const s = this.state();
    if (s)
      await firstValueFrom(
        this.raw.post('/api/auth/logout', { refreshToken: s.refreshToken }),
      ).catch(() => {});
    this.clear();
  }

  clear(reason?: 'expired') {
    this.save(null);
    this.router.navigate(['/login'], reason ? { queryParams: { motivo: reason } } : {});
  }

  can(module: Module, level: Level = 'read'): boolean {
    const p = this.user()?.permissions?.[module] ?? 'none';
    return level === 'read' ? p !== 'none' : p === 'write';
  }

  /** Ruta inicial según el rol. */
  home(): string {
    const u = this.user();
    if (!u) return '/login';
    if (u.role === 'driver') return '/mi-turno';
    if (u.role === 'support') return '/soporte';
    return this.can('dashboard') ? '/inicio' : '/mapa';
  }
}

/** Adjunta el Bearer y reintenta una vez tras renovar el token cuando la API responde 401. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const isAuthCall = /\/api\/auth\/(login|refresh|logout|forgot-password|reset-password)/.test(
    req.url,
  );
  const withToken = (r: HttpRequest<unknown>, token: string | null) =>
    token ? r.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : r;
  return next(withToken(req, isAuthCall ? null : auth.accessToken())).pipe(
    catchError((err) => {
      if (
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        !isAuthCall &&
        auth.isLoggedIn()
      ) {
        return from(auth.refresh()).pipe(
          switchMap((token) => (token ? next(withToken(req, token)) : throwError(() => err))),
        );
      }
      return throwError(() => err);
    }),
  );
};

export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  return auth.isLoggedIn() ? true : inject(Router).createUrlTree(['/login']);
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  return auth.isLoggedIn() ? inject(Router).createUrlTree([auth.home()]) : true;
};

/** Guard por permiso de módulo (RF32) o rol. */
export const permGuard =
  (module: Module | null, roles?: Session['role'][]): CanActivateFn =>
  () => {
    const auth = inject(Auth);
    const u = auth.user();
    const ok = !!u && (!module || auth.can(module)) && (!roles || roles.includes(u.role));
    return ok ? true : inject(Router).createUrlTree([auth.home()]);
  };
