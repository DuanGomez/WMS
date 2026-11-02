import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  Injector,
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

/** Un decimal fijo, como nf(v, 1) del prototipo. El formateador se crea una vez (crearlo es caro). */
const NF1 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf1 = (v: number) => NF1.format(v);
const WEEKDAY = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'short' });


/**
 * Último resumen cargado y de quién es. Al volver a Inicio se dibuja de una vez con él (sin esqueleto y sin
 * dibujar dos veces) y se refresca detrás; solo se usa si es del mismo usuario.
 */
let ultimo: { user: string; data: Dashboard } | null = null;

/** Igualdad de dos respuestas de la API sin pasarlas a texto. */
const igualJson = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!igualJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
};

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
  private readonly previo = ultimo?.user === this.auth.user()?.id ? ultimo : null;
  readonly data = signal<Dashboard | null>(this.previo?.data ?? null);
  private injector = inject(Injector);
  /** La segunda fila (fuera de la primera pantalla en celular) se dibuja cuando el navegador queda libre. */
  readonly segundaFila = signal(false);
  private filaProgramada = false;
  private lastLoad = 0;
  private lastData: Dashboard | null = this.previo?.data ?? null;
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
    return WEEKDAY.format(new Date(iso)).replace('.', '');
  }

  /** Después de dibujar lo de arriba con datos, la segunda fila espera a que el navegador quede libre. */
  private programarFila() {
    if (this.filaProgramada || this.segundaFila() || this.destroyRef.destroyed) return;
    this.filaProgramada = true;
    afterNextRender(
      () => {
        const libre =
          window.requestIdleCallback ?? ((f: IdleRequestCallback) => window.setTimeout(f, 200));
        libre(() => this.segundaFila.set(true), { timeout: 1500 });
      },
      { injector: this.injector },
    );
  }

  async ngOnInit() {
    if (this.data()) this.programarFila();
    await this.load();
    // Si se salió de la vista mientras cargaba, no se crean la suscripción ni el intervalo (quedarían vivos).
    if (this.destroyRef.destroyed) return;
    // KPIs se refrescan cada 15 s y con las alertas nuevas, como mucho una vez cada 15 s
    this.sub = this.live.alerts$.subscribe(() => {
      if (Date.now() - this.lastLoad > 15000) this.load();
    });
    this.timer = setInterval(() => this.load(), 15000);
  }
  ngOnDestroy() {
    this.sub?.unsubscribe();
    clearInterval(this.timer);
  }

  async load() {
    try {
      const d = await this.api.get<Dashboard>('dashboard');
      this.lastLoad = Date.now();
      // Si el resumen no cambió, no se vuelve a dibujar
      const user = this.auth.user()?.id;
      if (user) ultimo = { user, data: d };
      const igual = igualJson(d, this.lastData);
      if (!igual) {
        this.lastData = d;
        this.data.set(d);
      }
      this.programarFila();
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
