import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { VEHICLE_TYPES } from '../../core/format';
import { Live } from '../../core/live.service';
import { AuthResponse, Session } from '../../core/models';
import { Theme, ThemePref, Toasts } from '../../core/ui.services';
import { ToggleComponent } from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';

interface SimState {
  connected: boolean;
  lastHeartbeatAt: string | null;
  paused: boolean;
  speedFactor: number;
  scenarios: {
    id: string;
    vehicleKey: string;
    type: string;
    durationS: number;
    requestedAt: string;
  }[];
  catalog: { id: string; label: string; durationS: number; description: string }[];
  vehicles: {
    key: string;
    plate: string;
    type: string;
    label: string;
    mode: string;
    progress: number;
    speed: number;
    laps: number;
  }[];
}

const SCENARIO_ICONS: Record<string, { icon: string; tone: string }> = {
  stop: { icon: 'clock', tone: 'orange' },
  signal_loss: { icon: 'wifi-off', tone: 'red' },
  deviation: { icon: 'route', tone: 'purple' },
  theft: { icon: 'siren', tone: 'red' },
};
const MODE_LABELS: Record<string, string> = {
  route: 'En ruta',
  stopped: 'Detenido (semáforo/entrega)',
  stop: 'Parada prolongada',
  signal_loss: 'Sin señal',
  deviation: 'Desviado',
  theft: 'Robo simulado',
  paused: 'En pausa',
  offline: 'Sin conexión',
};

/** Perfil, seguridad (RF27), apariencia, notificaciones y panel del simulador GPS de la demo. */
@Component({
  selector: 'app-settings',
  imports: [FormsModule, IconComponent, ToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage implements OnInit, OnDestroy {
  private api = inject(Api);
  readonly auth = inject(Auth);
  readonly theme = inject(Theme);
  readonly live = inject(Live);
  private toasts = inject(Toasts);

  profile = { name: '', phone: '' };
  pw = { current: '', next: '', confirm: '' };
  readonly busy = signal('');
  readonly pwError = signal('');
  readonly themeOptions = [
    { value: 'light', label: 'Claro' },
    { value: 'dark', label: 'Oscuro' },
    { value: 'auto', label: 'Automático' },
  ];

  readonly sim = signal<SimState | null>(null);
  readonly simError = signal('');
  readonly now = signal(Date.now());
  readonly speedOptions = [1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n}×` }));
  readonly scenarioIcons = SCENARIO_ICONS;
  readonly modeLabels = MODE_LABELS;
  readonly types = VEHICLE_TYPES;
  readonly canSim = computed(() => this.auth.can('simulator'));
  readonly canSimWrite = computed(() => this.auth.can('simulator', 'write'));
  /** Vehículo sobre el que se lanzan los escenarios (se elige tocando su fila; por defecto el primero en ruta). */
  readonly selKey = signal<string | null>(null);
  readonly selected = computed(() => {
    const vs = this.sim()?.vehicles ?? [];
    return vs.find((v) => v.key === this.selKey()) ?? vs.find((v) => v.mode === 'route') ?? vs[0] ?? null;
  });
  scenarioLabel(type: string) {
    return this.sim()?.catalog.find((c) => c.id === type)?.label ?? type;
  }
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit() {
    const u = this.auth.user();
    this.profile = { name: u?.name ?? '', phone: u?.phone ?? '' };
    if (this.canSim()) {
      this.loadSim();
      this.timer = setInterval(() => {
        this.now.set(Date.now());
        this.loadSim();
      }, 2000);
    }
    if (location.hash === '#simulador')
      setTimeout(
        () => document.getElementById('simulador')?.scrollIntoView({ behavior: 'smooth' }),
        300,
      );
  }
  ngOnDestroy() {
    clearInterval(this.timer);
  }

  async saveProfile() {
    this.busy.set('profile');
    try {
      this.auth.updateUser(await this.api.patch<Session>('auth/me', this.profile));
      this.toasts.success('Perfil actualizado');
    } catch (e) {
      this.toasts.error('No se pudo guardar', errorMessage(e));
    } finally {
      this.busy.set('');
    }
  }

  /** RF27 – Cambiar contraseña (revoca las demás sesiones). */
  async changePassword() {
    this.pwError.set('');
    // Prototipo: el botón siempre está activo y valida al pulsarlo
    if (!this.pw.current) return this.pwError.set('Ingresa tu contraseña actual.');
    if (!(this.pw.next.length >= 8 && /[a-zA-Z]/.test(this.pw.next) && /\d/.test(this.pw.next)))
      return this.pwError.set('8+ caracteres con letras y números');
    if (this.pw.next !== this.pw.confirm)
      return this.pwError.set('Las contraseñas nuevas no coinciden.');
    this.busy.set('pw');
    try {
      const r = await this.api.post<AuthResponse>('auth/change-password', {
        currentPassword: this.pw.current,
        newPassword: this.pw.next,
      });
      this.auth.setSession(r);
      this.pw = { current: '', next: '', confirm: '' };
      this.toasts.success(
        'Contraseña actualizada',
        'Se cerraron las sesiones en otros dispositivos.',
      );
    } catch (e) {
      this.pwError.set(errorMessage(e));
    } finally {
      this.busy.set('');
    }
  }

  setTheme(v: string) {
    this.theme.set(v as ThemePref);
  }

  /* -------- Simulador GPS -------- */
  async loadSim() {
    try {
      this.sim.set(await this.api.get<SimState>('simulator/state'));
      this.simError.set('');
    } catch (e) {
      this.simError.set(errorMessage(e));
    }
  }

  async setPaused(paused: boolean) {
    await this.api.patch('simulator/state', { paused });
    this.toasts.info(paused ? 'Simulación en pausa' : 'Simulación reanudada');
    this.loadSim();
  }

  async setSpeed(v: string) {
    await this.api.patch('simulator/state', { speedFactor: Number(v) });
    this.loadSim();
  }

  scenarioFor(key: string) {
    return this.sim()?.scenarios.find((s) => s.vehicleKey === key) ?? null;
  }

  remaining(s: { requestedAt: string; durationS: number }) {
    return Math.max(
      0,
      Math.round((Date.parse(s.requestedAt) + s.durationS * 1000 - this.now()) / 1000),
    );
  }

  async trigger(vehicleKey: string, type: string, label: string, plate: string) {
    try {
      await this.api.post('simulator/scenarios', { vehicleKey, type });
      this.toasts.show(
        {
          title: `Escenario «${label}»`,
          text: `Aplicado a ${plate}. Observa el mapa y las alertas.`,
          icon: SCENARIO_ICONS[type].icon,
          tone: 'purple',
          app: 'Simulador GPS',
        },
        4500,
      );
      this.loadSim();
    } catch (e) {
      this.toasts.error('No se pudo activar', errorMessage(e));
    }
  }
}
