import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { Auth } from '../core/auth.service';
import { Live } from '../core/live.service';
import { Module } from '../core/models';
import { Confirm, pref } from '../core/ui.services';
import { IconComponent } from '../ui/icon.component';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  module: Module | null;
  roles?: string[];
  group: 'Monitoreo' | 'Flota' | 'Gestión' | 'Cuenta';
  badge?: boolean;
}

const NAV: NavItem[] = [
  {
    path: '/mi-turno',
    label: 'Mi turno',
    icon: 'navigation',
    module: null,
    roles: ['driver'],
    group: 'Monitoreo',
  },
  { path: '/inicio', label: 'Inicio', icon: 'dashboard', module: 'dashboard', group: 'Monitoreo' },
  { path: '/mapa', label: 'Mapa en vivo', icon: 'map', module: 'map', group: 'Monitoreo' },
  {
    path: '/alertas',
    label: 'Alertas',
    icon: 'bell',
    module: 'alerts',
    group: 'Monitoreo',
    badge: true,
  },
  { path: '/vehiculos', label: 'Vehículos', icon: 'car', module: 'vehicles', group: 'Flota' },
  {
    path: '/conductores',
    label: 'Conductores',
    icon: 'id-card',
    module: 'drivers',
    group: 'Flota',
  },
  {
    path: '/dispositivos',
    label: 'Dispositivos GPS',
    icon: 'satellite-dish',
    module: 'devices',
    group: 'Flota',
  },
  { path: '/geocercas', label: 'Geocercas', icon: 'hexagon', module: 'geofences', group: 'Flota' },
  { path: '/reportes', label: 'Reportes', icon: 'file-text', module: 'reports', group: 'Gestión' },
  {
    path: '/usuarios',
    label: 'Usuarios y permisos',
    icon: 'users',
    module: 'users',
    group: 'Gestión',
  },
  {
    path: '/suscripcion',
    label: 'Suscripción',
    icon: 'credit-card',
    module: 'billing',
    group: 'Gestión',
  },
  { path: '/soporte', label: 'Soporte', icon: 'life-buoy', module: 'support', group: 'Gestión' },
  { path: '/ajustes', label: 'Ajustes', icon: 'settings', module: null, group: 'Cuenta' },
];

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent implements OnInit, OnDestroy {
  readonly auth = inject(Auth);
  readonly live = inject(Live);
  private router = inject(Router);
  private confirm = inject(Confirm);

  readonly collapsed = pref('sidebarCollapsed', false);
  readonly moreOpen = signal(false);
  readonly fullBleed = signal(false);

  readonly items = computed(() => {
    const u = this.auth.user();
    if (!u) return [];
    return NAV.filter(
      (n) => (!n.roles || n.roles.includes(u.role)) && (!n.module || this.auth.can(n.module)),
    );
  });
  readonly groups = computed(() => {
    const out: { name: string; items: NavItem[] }[] = [];
    for (const it of this.items()) {
      let g = out.find((x) => x.name === it.group);
      if (!g) out.push((g = { name: it.group, items: [] }));
      g.items.push(it);
    }
    return out;
  });
  readonly tabs = computed(() =>
    this.items()
      .filter((i) => i.path !== '/ajustes')
      .slice(0, 4),
  );
  readonly moreItems = computed(() => {
    const tabs = new Set(this.tabs().map((t) => t.path));
    return this.items().filter((i) => !tabs.has(i.path));
  });
  readonly initials = computed(() =>
    (this.auth.user()?.name ?? '?')
      .split(' ')
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase(),
  );
  readonly liveLabel = computed(
    () =>
      ({
        sse: 'En vivo',
        polling: 'En vivo (polling)',
        connecting: 'Conectando…',
        offline: 'Sin conexión',
      })[this.live.mode()],
  );

  ngOnInit() {
    this.live.start();
    this.updateBleed(this.router.url);
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      this.updateBleed((e as NavigationEnd).urlAfterRedirects);
      this.moreOpen.set(false);
    });
  }
  ngOnDestroy() {
    this.live.stop();
  }

  private updateBleed(url: string) {
    this.fullBleed.set(url.startsWith('/mapa') || url.startsWith('/geocercas'));
  }

  async logout() {
    const ok = await this.confirm.ask({
      title: '¿Cerrar sesión?',
      message: 'Se cerrará tu sesión de forma segura en este dispositivo.',
      confirmText: 'Cerrar sesión',
      destructive: true,
    });
    if (!ok) return;
    this.live.stop();
    await this.auth.logout();
  }
}
