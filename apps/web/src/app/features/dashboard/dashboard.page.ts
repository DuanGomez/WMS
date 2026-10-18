import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { Api, errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { ALERT_ICONS, DtPipe, fmt, NumPipe, PRIORITY, VEHICLE_TYPES } from '../../core/format';
import { Live } from '../../core/live.service';
import { Alert } from '../../core/models';
import { Toasts } from '../../core/ui.services';
import { BarChartComponent, BarDatum } from '../../ui/bar-chart.component';
import { EmptyComponent } from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';
import { MorphWidthDirective } from '../../ui/motion-directives';
import { CountDirective, SwipeDirective } from '../../ui/wms-fx';

interface Dashboard {
  vehicles: { total: number; online: number; moving: number };
  openAlerts: { total: number; critical: number };
  kmToday: number;
  devices: { total: number; failing: number };
  days: { day: string; km: number; alerts: number; trips: number }[];
  alertsByType: { type: string; count: number }[];
  topVehicles: { id: string; plate: string; type: string; km: number }[];
  recentAlerts: Alert[];
}

/** Un decimal fijo, como nf(v, 1) del prototipo. */
const nf1 = (v: number) =>
  new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);

const TYPE_LABELS: Record<string, string> = {
  geofence_enter: 'Entrada a geocerca',
  geofence_exit: 'Salida de geocerca',
  prolonged_stop: 'Parada prolongada',
  signal_loss: 'Pérdida de señal',
  route_deviation: 'Desvío de ruta',
  speeding: 'Exceso de velocidad',
  theft: 'Posible robo',
  low_battery: 'Batería baja',
  emergency: 'Emergencia',
  signal_restored: 'Señal recuperada',
};

@Component({
  selector: 'app-dashboard',
  imports: [
    MorphWidthDirective,
    RouterLink,
    IconComponent,
    BarChartComponent,
    EmptyComponent,
    DtPipe,
    NumPipe,
    CountDirective,
    SwipeDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
})
export class DashboardPage implements OnInit, OnDestroy {
  private api = inject(Api);
  readonly auth = inject(Auth);
  private live = inject(Live);
  private destroyRef = inject(DestroyRef);
  private toasts = inject(Toasts);
  readonly data = signal<Dashboard | null>(null);
  readonly error = signal('');
  private sub?: Subscription;
  private timer?: ReturnType<typeof setInterval>;
  readonly icons = ALERT_ICONS;
  readonly priority = PRIORITY;
  readonly vtypes = VEHICLE_TYPES;
  readonly typeLabels = TYPE_LABELS;

  readonly greeting = computed(() => {
    const h = Number(
      new Intl.DateTimeFormat('es-CO', {
        timeZone: 'America/Bogota',
        hour: 'numeric',
        hour12: false,
      }).format(new Date()),
    );
    const name = this.auth.user()?.name.split(' ')[0] ?? '';
    return `${h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'}, ${name}`;
  });
  readonly today = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  readonly kmSeries = computed<BarDatum[]>(() =>
    (this.data()?.days ?? []).map((d) => ({
      label: this.dayLabel(d.day),
      value: d.km,
      tip: `${fmt.date(d.day)} · ${d.trips} recorridos`,
      text: `${nf1(d.km)} km · ${d.trips} recorridos`,
    })),
  );
  readonly alertSeries = computed<BarDatum[]>(() =>
    (this.data()?.days ?? []).map((d) => ({
      label: this.dayLabel(d.day),
      value: d.alerts,
      tip: fmt.date(d.day),
      text: `${d.alerts} ${d.alerts === 1 ? 'alerta' : 'alertas'}`,
    })),
  );
  /** Subtítulo del prototipo: "1.305,3 km esta semana · 67 recorridos". */
  readonly kmWeek = computed(() => {
    const days = this.data()?.days ?? [];
    const km = days.reduce((s, d) => s + d.km, 0);
    const trips = days.reduce((s, d) => s + d.trips, 0);
    return `${nf1(km)} km esta semana · ${trips} recorridos`;
  });
  readonly byTypeMax = computed(() =>
    Math.max(1, ...(this.data()?.alertsByType ?? []).map((a) => a.count)),
  );
  readonly topMax = computed(() =>
    Math.max(1, ...(this.data()?.topVehicles ?? []).map((a) => a.km)),
  );

  dayLabel(iso: string) {
    return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'short' })
      .format(new Date(iso))
      .replace('.', '');
  }

  async ngOnInit() {
    await this.load();
    // Si se salió de la vista mientras cargaba, no se crean la suscripción ni el intervalo (quedarían vivos).
    if (this.destroyRef.destroyed) return;
    // KPIs se refrescan con cada alerta y cada 15 s
    this.sub = this.live.alerts$.subscribe(() => this.load());
    this.timer = setInterval(() => this.load(), 15000);
  }
  ngOnDestroy() {
    this.sub?.unsubscribe();
    clearInterval(this.timer);
  }

  async load() {
    try {
      this.data.set(await this.api.get<Dashboard>('dashboard'));
      this.error.set('');
    } catch (e) {
      if (!this.data()) this.error.set(errorMessage(e));
    }
  }

  /** Como el prototipo: al atender, el botón pasa al instante a un círculo sólido con "pop" (260 ms). */
  /** Móvil (≤760 px): la gráfica de km mide 170 px como en el prototipo (chartH). */
  readonly mob = signal(typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches);
  readonly attending = signal<ReadonlySet<string>>(new Set());
  readonly popped = signal<string | null>(null);
  isDone(a: Alert) {
    return a.attended || this.attending().has(a.id);
  }
  private setAttending(id: string, on: boolean) {
    this.attending.update((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  async attend(a: Alert) {
    if (this.isDone(a)) return;
    this.setAttending(a.id, true);
    this.popped.set(a.id);
    setTimeout(() => this.popped() === a.id && this.popped.set(null), 260);
    try {
      await this.api.post(`alerts/${a.id}/attend`);
      this.live.openAlerts.update((n) => Math.max(0, n - 1));
      this.toasts.success('Alerta atendida');
      await this.load();
    } catch (e) {
      this.toasts.error('No se pudo atender', errorMessage(e));
    } finally {
      this.setAttending(a.id, false);
    }
  }
}
