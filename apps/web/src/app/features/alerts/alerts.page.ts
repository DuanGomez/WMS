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
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { Api, errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { ALERT_ICONS, DtPipe, PRIORITY } from '../../core/format';
import { Live } from '../../core/live.service';
import { Alert, AlertRule, Geofence, NotificationItem, Vehicle } from '../../core/models';
import { Confirm, Toasts } from '../../core/ui.services';
import {
  EmptyComponent,
  SegmentedComponent,
  SheetComponent,
  SkeletonListComponent,
  ToggleComponent,
} from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';

const RULE_TYPES: Record<
  string,
  {
    label: string;
    unit?: string;
    help: string;
    needsGeofence?: boolean;
    needsThreshold?: boolean;
    defaultThreshold?: number;
  }
> = {
  geofence_enter: {
    label: 'Entrada a geocerca',
    help: 'Avisa cuando un vehículo entra a la geocerca (o a cualquiera si no eliges una).',
    needsGeofence: false,
  },
  geofence_exit: {
    label: 'Salida de geocerca',
    help: 'Avisa cuando un vehículo sale de la geocerca.',
    needsGeofence: false,
  },
  route_deviation: {
    label: 'Desvío de ruta',
    help: 'Avisa cuando el vehículo sale del corredor o zona de ruta autorizada.',
    needsGeofence: true,
  },
  prolonged_stop: {
    label: 'Parada prolongada',
    unit: 'segundos',
    help: 'Tiempo detenido (velocidad ≈ 0) antes de alertar. En producción se recomienda 600 s (10 min).',
    needsThreshold: true,
    defaultThreshold: 600,
  },
  signal_loss: {
    label: 'Pérdida de señal / falla GPS',
    unit: 'segundos',
    help: 'Tiempo sin recibir datos del dispositivo antes de alertar.',
    needsThreshold: true,
    defaultThreshold: 180,
  },
  speeding: {
    label: 'Exceso de velocidad',
    unit: 'km/h',
    help: 'Velocidad máxima permitida.',
    needsThreshold: true,
    defaultThreshold: 60,
  },
  theft: {
    label: 'Movimiento no autorizado (robo)',
    unit: 'km/h',
    help: 'Alerta crítica si el vehículo se mueve por encima de esta velocidad con el encendido apagado.',
    defaultThreshold: 5,
  },
  low_battery: {
    label: 'Batería baja del GPS',
    unit: '%',
    help: 'Porcentaje mínimo de batería del dispositivo.',
    needsThreshold: true,
    defaultThreshold: 20,
  },
};

/** RG4 / RF15-RF18 – Reglas de alerta, historial y notificaciones enviadas. */
@Component({
  selector: 'app-alerts',
  imports: [
    FormsModule,
    IconComponent,
    SheetComponent,
    EmptyComponent,
    SkeletonListComponent,
    SegmentedComponent,
    ToggleComponent,
    DtPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './alerts.page.html',
  styleUrl: './alerts.page.scss',
})
export class AlertsPage implements OnInit, OnDestroy {
  private api = inject(Api);
  readonly auth = inject(Auth);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  private live = inject(Live);
  private router = inject(Router);

  readonly tab = signal('history');
  readonly tabs = computed(() => [
    { value: 'history', label: 'Historial' },
    { value: 'rules', label: 'Reglas' },
    ...(this.auth.user()?.role !== 'driver'
      ? [{ value: 'sent', label: 'Notificaciones enviadas' }]
      : []),
  ]);
  readonly canWrite = computed(() => this.auth.can('alerts', 'write'));
  readonly icons = ALERT_ICONS;
  readonly priority = PRIORITY;
  readonly ruleTypes = RULE_TYPES;
  readonly ruleTypeKeys = Object.keys(RULE_TYPES);

  // Historial
  readonly alerts = signal<Alert[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly state = signal<'open' | 'attended' | 'all'>('open');
  readonly typeF = signal('');
  readonly priorityF = signal('');
  readonly vehicleF = signal('');
  readonly stateOptions = [
    { value: 'open', label: 'Abiertas' },
    { value: 'attended', label: 'Atendidas' },
    { value: 'all', label: 'Todas' },
  ];
  readonly allTypes = Object.entries(ALERT_ICONS).map(([k]) => k);
  readonly typeNames: Record<string, string> = {
    ...Object.fromEntries(Object.entries(RULE_TYPES).map(([k, v]) => [k, v.label])),
    emergency: 'Emergencia del conductor',
    signal_restored: 'Señal recuperada',
  };

  // Reglas
  readonly rules = signal<AlertRule[]>([]);
  readonly geofences = signal<Geofence[]>([]);
  readonly vehicles = signal<Vehicle[]>([]);
  readonly sheetOpen = signal(false);
  readonly editing = signal<AlertRule | null>(null);
  readonly busy = signal(false);
  readonly formError = signal('');
  form: any = {};

  // Notificaciones
  readonly notifications = signal<NotificationItem[]>([]);
  readonly expanded = signal<string | null>(null);

  private sub?: Subscription;

  async ngOnInit() {
    await this.loadHistory();
    this.sub = this.live.alerts$.subscribe((a) => {
      if (this.state() !== 'attended' && (!this.typeF() || this.typeF() === a.type)) {
        this.alerts.update((l) => [a, ...l.filter((x) => x.id !== a.id)]);
        this.total.update((n) => n + 1);
      }
      if (this.tab() === 'sent') this.loadSent();
    });
    if (this.auth.can('vehicles')) this.vehicles.set(await this.api.get<Vehicle[]>('vehicles'));
  }
  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  async setTab(t: string) {
    this.tab.set(t);
    if (t === 'rules') await this.loadRules();
    if (t === 'sent') await this.loadSent();
  }

  async loadHistory(append = false) {
    if (!append) this.loading.set(true);
    try {
      const r = await this.api.get<{ items: Alert[]; total: number; open: number }>('alerts', {
        attended: this.state() === 'all' ? undefined : this.state() === 'attended',
        type: this.typeF() || undefined,
        priority: this.priorityF() || undefined,
        vehicleId: this.vehicleF() || undefined,
        limit: 30,
        offset: append ? this.alerts().length : 0,
      });
      this.alerts.set(append ? [...this.alerts(), ...r.items] : r.items);
      this.total.set(r.total);
      this.live.openAlerts.set(r.open);
    } catch (e) {
      this.toasts.error('No se pudo cargar el historial', errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  setFilter(kind: 'state' | 'type' | 'priority' | 'vehicle', v: string) {
    if (kind === 'state') this.state.set(v as any);
    if (kind === 'type') this.typeF.set(v);
    if (kind === 'priority') this.priorityF.set(v);
    if (kind === 'vehicle') this.vehicleF.set(v);
    this.loadHistory();
  }

  async attend(a: Alert) {
    try {
      const r = await this.api.post<Alert>(`alerts/${a.id}/attend`);
      this.alerts.update((l) =>
        this.state() === 'open'
          ? l.filter((x) => x.id !== a.id)
          : l.map((x) => (x.id === a.id ? r : x)),
      );
      this.live.openAlerts.update((n) => Math.max(0, n - 1));
      this.toasts.success('Alerta atendida');
    } catch (e) {
      this.toasts.error('No se pudo atender', errorMessage(e));
    }
  }

  async attendAll() {
    const ok = await this.confirm.ask({
      title: '¿Marcar todas como atendidas?',
      message: 'Se marcarán todas las alertas abiertas de tu empresa.',
      confirmText: 'Marcar todas',
    });
    if (!ok) return;
    const r = await this.api.post<{ updated: number }>('alerts/attend-all');
    this.toasts.success(`${r.updated} alertas atendidas`);
    this.live.openAlerts.set(0);
    this.loadHistory();
  }

  viewOnMap(a: Alert) {
    this.router.navigate(['/mapa'], { queryParams: a.vehicleId ? { v: a.vehicleId } : {} });
  }

  /* ---------------- Reglas ---------------- */
  async loadRules() {
    try {
      const [r, g] = await Promise.all([
        this.api.get<AlertRule[]>('alert-rules'),
        this.auth.can('geofences') ? this.api.get<Geofence[]>('geofences') : Promise.resolve([]),
      ]);
      this.rules.set(r);
      this.geofences.set(g);
    } catch (e) {
      this.toasts.error('No se pudieron cargar las reglas', errorMessage(e));
    }
  }

  thresholdText(r: AlertRule) {
    const t = RULE_TYPES[r.type];
    if (r.threshold == null || !t?.unit) return '';
    if (t.unit === 'segundos')
      return r.threshold >= 120 ? `${Math.round(r.threshold / 60)} min` : `${r.threshold} s`;
    return `${r.threshold} ${t.unit}`;
  }

  openCreate() {
    this.editing.set(null);
    this.form = {
      name: '',
      type: 'prolonged_stop',
      threshold: 600,
      geofenceId: null,
      vehicleIds: [],
      recipients: '',
      email: false,
      push: true,
      priority: 'high',
      active: true,
    };
    this.formError.set('');
    this.sheetOpen.set(true);
  }

  openEdit(r: AlertRule) {
    this.editing.set(r);
    this.form = {
      name: r.name,
      type: r.type,
      threshold: r.threshold,
      geofenceId: r.geofenceId,
      vehicleIds: [...r.vehicleIds],
      recipients: r.recipients.join(', '),
      email: r.channels.includes('email'),
      push: r.channels.includes('push'),
      priority: r.priority,
      active: r.active,
    };
    this.formError.set('');
    this.sheetOpen.set(true);
  }

  onTypeChange(t: string) {
    this.form.type = t;
    this.form.threshold = RULE_TYPES[t].defaultThreshold ?? null;
    if (!this.form.name) this.form.name = RULE_TYPES[t].label;
  }

  toggleVehicle(id: string, on: boolean) {
    this.form.vehicleIds = on
      ? [...this.form.vehicleIds, id]
      : this.form.vehicleIds.filter((x: string) => x !== id);
  }

  async saveRule() {
    this.busy.set(true);
    this.formError.set('');
    const f = this.form;
    const body = {
      name: f.name,
      type: f.type,
      threshold: f.threshold === '' || f.threshold == null ? null : Number(f.threshold),
      geofenceId: f.geofenceId || null,
      vehicleIds: f.vehicleIds,
      recipients: String(f.recipients ?? '')
        .split(/[,;\s]+/)
        .map((x: string) => x.trim())
        .filter(Boolean),
      channels: ['inapp', ...(f.email ? ['email'] : []), ...(f.push ? ['push'] : [])],
      priority: f.priority,
      active: f.active,
    };
    try {
      if (this.editing()) await this.api.patch(`alert-rules/${this.editing()!.id}`, body);
      else await this.api.post('alert-rules', body);
      this.toasts.success(this.editing() ? 'Regla actualizada' : 'Regla creada', body.name);
      this.sheetOpen.set(false);
      await this.loadRules();
    } catch (e) {
      this.formError.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async toggleRule(r: AlertRule, active: boolean) {
    try {
      await this.api.patch(`alert-rules/${r.id}`, { active });
      await this.loadRules();
    } catch (e) {
      this.toasts.error('No se pudo actualizar', errorMessage(e));
      await this.loadRules();
    }
  }

  async removeRule(r: AlertRule) {
    const ok = await this.confirm.ask({
      title: `¿Eliminar la regla «${r.name}»?`,
      message: 'Dejará de generar alertas. El historial se conserva.',
      confirmText: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(`alert-rules/${r.id}`);
      this.toasts.success('Regla eliminada');
      this.sheetOpen.set(false);
      await this.loadRules();
    } catch (e) {
      this.toasts.error('No se pudo eliminar', errorMessage(e));
    }
  }

  /* ---------------- Notificaciones enviadas ---------------- */
  async loadSent() {
    try {
      this.notifications.set(
        await this.api.get<NotificationItem[]>('notifications', { limit: 150 }),
      );
    } catch (e) {
      this.toasts.error('No se pudo cargar la bandeja', errorMessage(e));
    }
  }
}
