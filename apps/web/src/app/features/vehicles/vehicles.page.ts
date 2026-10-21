import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { DtPipe, fmt, VEHICLE_STATUS, VEHICLE_TYPES } from '../../core/format';
import { Device, Driver, Vehicle, VehicleType } from '../../core/models';
import { Confirm, Toasts } from '../../core/ui.services';
import {
  EmptyComponent,
  SegmentedComponent,
  SheetComponent,
  SkeletonListComponent,
  ToggleComponent,
} from '../../ui/components';
import { DetailComponent, DetailRow } from '../../ui/detail.component';
import { IconComponent } from '../../ui/icon.component';
import { DebounceInputDirective, MorphWidthDirective } from '../../ui/motion-directives';
import { PlaybackComponent } from '../map/playback.component';
import { BoardDragDirective } from '../../ui/wms-fx';

interface Form {
  plate: string;
  type: VehicleType;
  brand: string;
  model: string;
  year: number | null;
  color: string;
  status: 'active' | 'maintenance' | 'inactive';
  deviceId: string | null;
  driverId: string | null;
}

const empty = (): Form => ({
  plate: '',
  type: 'moto',
  brand: '',
  model: '',
  year: new Date().getFullYear(),
  color: '',
  status: 'active',
  deviceId: null,
  driverId: null,
});

/** RF1-RF4 · HU2 – Gestión de vehículos. */
@Component({
  selector: 'app-vehicles',
  imports: [
    MorphWidthDirective,
    DebounceInputDirective,
    FormsModule,
    IconComponent,
    SheetComponent,
    EmptyComponent,
    SkeletonListComponent,
    SegmentedComponent,
    ToggleComponent,
    PlaybackComponent,
    DtPipe,
    BoardDragDirective,
    DetailComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './vehicles.page.html',
  styleUrl: './vehicles.page.scss',
})
export class VehiclesPage implements OnInit {
  private api = inject(Api);
  readonly auth = inject(Auth);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  private router = inject(Router);
  readonly id = input<string>();
  readonly tab = input<string>();

  readonly vehicles = signal<Vehicle[]>([]);
  readonly devices = signal<Device[]>([]);
  readonly drivers = signal<Driver[]>([]);
  /** Solo en la primera carga: al recargar (guardar, filtrar) la lista sigue visible, sin pasar por el esqueleto. */
  readonly loading = signal(true);
  readonly q = signal('');
  readonly typeFilter = signal('all');
  readonly showRetired = signal(false);
  readonly sheetOpen = signal(false);
  readonly tripsOpen = signal(false);
  readonly tripsVehicle = signal<Vehicle | null>(null);
  readonly editing = signal<Vehicle | null>(null);
  readonly busy = signal(false);
  readonly formError = signal('');
  form: Form = empty();

  readonly types = VEHICLE_TYPES;
  readonly statuses = VEHICLE_STATUS;
  readonly typeOptions = [
    { value: 'all', label: 'Todos' },
    { value: 'moto', label: 'Motos' },
    { value: 'carro', label: 'Carros' },
    { value: 'camion', label: 'Camiones' },
    { value: 'furgon', label: 'Furgones' },
  ];
  readonly formTypeOptions = Object.entries(VEHICLE_TYPES).map(([value, v]) => ({
    value,
    label: v.label,
  }));
  readonly canWrite = computed(() => this.auth.can('vehicles', 'write'));

  readonly filtered = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.vehicles().filter(
      (v) =>
        (this.typeFilter() === 'all' || v.type === this.typeFilter()) &&
        (!q ||
          // El tipo también se busca ("moto", "camión"…): reemplaza los botones de tipo que el prototipo no tiene
          [v.plate, v.brand, v.model, v.driver?.name ?? '', this.types[v.type]?.label ?? ''].some((x) =>
            x.toLowerCase().includes(q),
          )),
    );
  });
  /** Máximo de vehículos del plan (prototipo: "4 / 15 vehículos de tu plan"); solo si el rol puede ver la suscripción. */
  readonly planMax = signal<number | null>(null);
  readonly activeCount = computed(() => this.vehicles().filter((v) => !v.retiredAt).length);
  /** Vehículo abierto en el panel de detalle (clic en la tarjeta, como el prototipo). */
  readonly detail = signal<Vehicle | null>(null);

  /** Estado en vivo para la tarjeta (prototipo: vStatusLive). */
  liveState(v: Vehicle): 'moving' | 'parked' | 'offline' | 'nogps' {
    if (!v.device || v.retiredAt) return 'nogps';
    if (v.device.connection !== 'online') return 'offline';
    return (v.live?.speed ?? 0) >= 2 ? 'moving' : 'parked';
  }
  detailRows(v: Vehicle): DetailRow[] {
    return [
      { k: 'Tipo', v: this.types[v.type]?.label ?? v.type },
      { k: 'Marca y modelo', v: [v.brand, v.model].filter(Boolean).join(' ') || '—' },
      { k: 'Año', v: v.year ? String(v.year) : '—' },
      { k: 'Color', v: v.color || '—' },
      { k: 'Conductor', v: v.driver?.name ?? 'Sin conductor' },
      { k: 'Dispositivo GPS', v: v.device ? v.device.serial : 'Sin dispositivo', mono: !!v.device },
      { k: 'Batería GPS', v: v.device?.battery != null ? v.device.battery + '%' : '—' },
      { k: 'Última posición', v: v.live?.ts ? fmt.relative(v.live.ts) : 'Sin posición' },
      ...(v.retiredReason ? [{ k: 'Motivo de baja', v: v.retiredReason }] : []),
    ];
  }

  /** Tablero por estado (rediseño). Mismos datos que la tabla: `filtered()`. */
  readonly board = computed(() => {
    const COLS: { key: Vehicle['status']; color: string }[] = [
      { key: 'active', color: 'var(--wms-text)' },
      { key: 'maintenance', color: 'var(--wms-muted)' },
      { key: 'inactive', color: 'var(--wms-faint)' },
    ];
    if (this.showRetired()) COLS.push({ key: 'retired', color: 'var(--wms-faint)' });
    const list = this.filtered();
    const tot = Math.max(1, list.length);
    return COLS.map((c) => {
      const items = list.filter((v) => v.status === c.key);
      const sub =
        c.key === 'active'
          ? `${items.filter((v) => this.liveState(v) === 'moving').length} en movimiento ahora`
          : c.key === 'maintenance'
            ? 'Fuera de operación'
            : c.key === 'inactive'
              ? 'Sin uso'
              : 'Solo historial';
      return {
        key: c.key,
        color: c.color,
        label: this.statuses[c.key].label,
        sub,
        items,
        share: (items.length / tot) * 100,
      };
    });
  });

  /**
   * Arrastrar una tarjeta a otra columna = cambiar el estado del vehículo.
   * Usa el mismo endpoint y el mismo cuerpo que save() (PATCH vehicles/:id).
   */
  async moveTo(id: string, status: string) {
    const v = this.vehicles().find((x) => x.id === id);
    if (!v || v.retiredAt || !this.canWrite()) return;
    if (status === 'retired') return this.retire(v);
    if (!['active', 'maintenance', 'inactive'].includes(status) || v.status === status) return;
    const prev = this.vehicles();
    this.vehicles.set(prev.map((x) => (x.id === id ? { ...x, status: status as Vehicle['status'] } : x)));
    try {
      await this.api.patch(`vehicles/${v.id}`, {
        plate: v.plate,
        type: v.type,
        brand: v.brand,
        model: v.model,
        year: v.year,
        color: v.color,
        status,
        deviceId: v.device?.id ?? null,
        driverId: v.driver?.id ?? null,
      });
      this.toasts.success('Vehículo actualizado', `${v.plate} · ${this.statuses[status].label}`);
    } catch (e) {
      this.vehicles.set(prev);
      this.toasts.error('No se pudo actualizar', errorMessage(e));
    }
  }

  /** Dispositivos libres + el actual del vehículo en edición. */
  readonly availableDevices = computed(() =>
    this.devices().filter(
      (d) => d.status !== 'retired' && (!d.vehicle || d.vehicle.id === this.editing()?.id),
    ),
  );

  async ngOnInit() {
    await this.load();
    const id = this.id();
    if (id) {
      const v = this.vehicles().find((x) => x.id === id);
      if (v && this.tab() === 'recorridos') this.openTrips(v);
      else if (v && this.canWrite()) this.openEdit(v);
    }
  }

  async load() {
    try {
      const [v, d, dr] = await Promise.all([
        this.api.get<Vehicle[]>('vehicles', { includeRetired: this.showRetired() }),
        this.auth.can('devices') ? this.api.get<Device[]>('devices') : Promise.resolve([]),
        this.auth.can('drivers') ? this.api.get<Driver[]>('drivers') : Promise.resolve([]),
      ]);
      this.vehicles.set(v);
      this.devices.set(d);
      this.drivers.set(dr);
      if (this.auth.can('billing') && this.planMax() == null)
        this.api.get<{ plan: { maxVehicles: number } }>('subscription').then((s) => this.planMax.set(s.plan.maxVehicles), () => {});
    } catch (e) {
      this.toasts.error('No se pudieron cargar los vehículos', errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  toggleRetired(v: boolean) {
    this.showRetired.set(v);
    this.load();
  }

  openCreate() {
    this.editing.set(null);
    this.form = empty();
    this.formError.set('');
    this.sheetOpen.set(true);
  }

  openEdit(v: Vehicle) {
    this.editing.set(v);
    this.form = {
      plate: v.plate,
      type: v.type,
      brand: v.brand,
      model: v.model,
      year: v.year,
      color: v.color,
      status: v.status === 'retired' ? 'inactive' : v.status,
      deviceId: v.device?.id ?? null,
      driverId: v.driver?.id ?? null,
    };
    this.formError.set('');
    this.sheetOpen.set(true);
  }

  openTrips(v: Vehicle) {
    this.tripsVehicle.set(v);
    this.tripsOpen.set(true);
  }

  async save() {
    this.busy.set(true);
    this.formError.set('');
    const body = { ...this.form, year: this.form.year ? Number(this.form.year) : null };
    try {
      const ed = this.editing();
      if (ed) {
        await this.api.patch(`vehicles/${ed.id}`, body);
        this.toasts.success('Vehículo actualizado', body.plate);
      } else {
        await this.api.post('vehicles', body);
        this.toasts.success(
          'Vehículo creado',
          `${body.plate.toUpperCase()} ya aparece en el mapa cuando su GPS reporte.`,
        );
      }
      this.sheetOpen.set(false);
      await this.load();
    } catch (e) {
      this.formError.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** RF4 – Dar de baja con motivo. */
  async retire(v: Vehicle) {
    const reason = await this.confirm.prompt({
      title: `¿Dar de baja ${v.plate}?`,
      message:
        'El vehículo dejará de aparecer en el mapa. Su histórico de recorridos y alertas se conserva.',
      confirmText: 'Dar de baja',
      destructive: true,
      input: {
        options: [
          { value: 'Vendido', label: 'Vendido' },
          { value: 'Robado', label: 'Robado' },
          { value: 'Siniestro / pérdida total', label: 'Siniestro / pérdida total' },
          { value: 'Fin de vida útil', label: 'Fin de vida útil' },
          { value: 'Otro', label: 'Otro' },
        ],
      },
    });
    if (!reason) return;
    try {
      await this.api.delete(`vehicles/${v.id}`, { reason });
      this.toasts.success('Vehículo dado de baja', v.plate);
      this.sheetOpen.set(false);
      await this.load();
    } catch (e) {
      this.toasts.error('No se pudo dar de baja', errorMessage(e));
    }
  }

  goMap(v: Vehicle) {
    this.router.navigate(['/mapa'], { queryParams: { v: v.id } });
  }

  connTone(v: Vehicle) {
    if (!v.device) return '';
    return v.device.connection === 'online' ? 'green' : 'red';
  }
}
