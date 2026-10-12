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
import { DtPipe, VEHICLE_STATUS, VEHICLE_TYPES } from '../../core/format';
import { Device, Driver, Vehicle, VehicleType } from '../../core/models';
import { Confirm, Toasts } from '../../core/ui.services';
import {
  EmptyComponent,
  SegmentedComponent,
  SheetComponent,
  SkeletonListComponent,
  ToggleComponent,
} from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';
import { PlaybackComponent } from '../map/playback.component';

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
    FormsModule,
    IconComponent,
    SheetComponent,
    EmptyComponent,
    SkeletonListComponent,
    SegmentedComponent,
    ToggleComponent,
    PlaybackComponent,
    DtPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './vehicles.page.html',
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
          [v.plate, v.brand, v.model, v.driver?.name ?? ''].some((x) =>
            x.toLowerCase().includes(q),
          )),
    );
  });

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
    this.loading.set(true);
    try {
      const [v, d, dr] = await Promise.all([
        this.api.get<Vehicle[]>('vehicles', { includeRetired: this.showRetired() }),
        this.auth.can('devices') ? this.api.get<Device[]>('devices') : Promise.resolve([]),
        this.auth.can('drivers') ? this.api.get<Driver[]>('drivers') : Promise.resolve([]),
      ]);
      this.vehicles.set(v);
      this.devices.set(d);
      this.drivers.set(dr);
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
