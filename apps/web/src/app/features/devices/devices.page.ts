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
import { Subscription } from 'rxjs';
import { Api, errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { DEVICE_STATUS, DtPipe } from '../../core/format';
import { Live } from '../../core/live.service';
import { Device, Vehicle } from '../../core/models';
import { Confirm, Toasts } from '../../core/ui.services';
import {
  EmptyComponent,
  SegmentedComponent,
  SheetComponent,
  SkeletonListComponent,
} from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';

const REASONS: Record<string, string> = {
  robado: 'Robado',
  dañado: 'Dañado',
  fin_vida_util: 'Fin de vida útil',
  otro: 'Otro',
};

/** RF28-RF31 – Gestión de dispositivos GPS independiente de los vehículos. */
@Component({
  selector: 'app-devices',
  imports: [
    FormsModule,
    IconComponent,
    SheetComponent,
    EmptyComponent,
    SkeletonListComponent,
    SegmentedComponent,
    DtPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="eyebrow">Flota</div>
          <h1 class="large-title">Dispositivos GPS</h1>
        </div>
        <div class="actions">
          @if (canWrite()) {
            <button class="btn primary" type="button" (click)="openCreate()">
              <app-icon name="plus" [size]="16" />Registrar dispositivo
            </button>
          }
        </div>
      </header>

      <div class="grid grid-4" style="margin-bottom:16px">
        <div class="card kpi">
          <div class="kpi-head"><span class="dot green"></span>En línea</div>
          <div class="kpi-value">{{ stats().online }}</div>
        </div>
        <div class="card kpi">
          <div class="kpi-head"><span class="dot red"></span>Sin señal / en falla</div>
          <div class="kpi-value">{{ stats().failing }}</div>
        </div>
        <div class="card kpi">
          <div class="kpi-head"><span class="dot"></span>Inactivos</div>
          <div class="kpi-value">{{ stats().inactive }}</div>
        </div>
        <div class="card kpi">
          <div class="kpi-head"><span class="dot blue"></span>Sin vehículo</div>
          <div class="kpi-value">{{ stats().free }}</div>
        </div>
      </div>

      <div class="row" style="margin-bottom:14px">
        <app-segmented
          [options]="filterOptions"
          [value]="filter()"
          (valueChange)="setFilter($event)"
        />
      </div>

      @if (loading()) {
        <app-skeleton-list />
      } @else if (!shown().length) {
        <div class="card">
          <app-empty
            icon="satellite-dish"
            title="Sin dispositivos"
            text="Registra los equipos GPS con su serial/IMEI; luego instálalos en un vehículo."
          />
        </div>
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Serial / IMEI</th>
                <th>Estado</th>
                <th>Conexión</th>
                <th>Batería</th>
                <th>Vehículo</th>
                <th>Último reporte</th>
                <th class="actions-cell"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (d of shown(); track d.id) {
                <tr>
                  <td>
                    <div class="mono" style="font-weight:600">{{ d.serial }}</div>
                    <div class="caption">{{ d.model }}</div>
                  </td>
                  <td>
                    <span class="badge" [class]="'badge ' + status[d.status].tone">{{
                      status[d.status].label
                    }}</span>
                    @if (d.retiredReason) {
                      <div class="caption">{{ reasons[d.retiredReason] ?? d.retiredReason }}</div>
                    }
                  </td>
                  <td>
                    <span class="row" style="gap:6px"
                      ><span
                        class="dot"
                        [class.green]="d.connection === 'online'"
                        [class.red]="d.connection === 'offline'"
                      ></span
                      >{{
                        d.connection === 'online'
                          ? 'En línea'
                          : d.connection === 'offline'
                            ? 'Sin señal'
                            : 'Sin datos'
                      }}</span
                    >
                  </td>
                  <td class="tabular">
                    @if (d.battery != null) {
                      <span class="row" style="gap:6px"
                        ><app-icon
                          [name]="d.battery < 20 ? 'battery-low' : 'battery'"
                          [size]="18"
                          [class.c-red]="d.battery < 20"
                        />{{ d.battery }}%</span
                      >
                    } @else {
                      —
                    }
                  </td>
                  <td>{{ d.vehicle?.plate ?? '—' }}</td>
                  <td class="caption">{{ d.lastSeenAt | dt: 'relative' }}</td>
                  <td class="actions-cell">
                    @if (canWrite() && d.status !== 'retired') {
                      <button
                        class="btn sm icon plain"
                        type="button"
                        title="Editar / reasignar"
                        aria-label="Editar o reasignar"
                        (click)="openEdit(d)"
                      >
                        <app-icon name="pencil" [size]="16" />
                      </button>
                      <button
                        class="btn sm icon plain"
                        type="button"
                        title="Ver API key"
                        aria-label="Ver API key"
                        (click)="showKey(d)"
                      >
                        <app-icon name="key" [size]="16" />
                      </button>
                      <button
                        class="btn sm icon plain danger"
                        type="button"
                        title="Dar de baja"
                        aria-label="Dar de baja"
                        (click)="retire(d)"
                      >
                        <app-icon name="trash" [size]="16" />
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    <app-sheet
      [(open)]="sheetOpen"
      [title]="editing() ? 'Dispositivo ' + editing()!.serial : 'Registrar dispositivo GPS'"
      actionText="Guardar"
      [busy]="busy()"
      (action)="save()"
    >
      <form class="form-grid" (ngSubmit)="save()">
        @if (!editing()) {
          <div class="field">
            <label for="s">Serial / IMEI</label
            ><input
              id="s"
              class="input mono"
              name="s"
              [(ngModel)]="form.serial"
              placeholder="860123450000606"
            />
          </div>
        }
        <div class="field" [class.full]="!!editing()">
          <label for="m">Modelo</label
          ><input
            id="m"
            class="input"
            name="m"
            [(ngModel)]="form.model"
            placeholder="Teltonika FMB920"
          />
        </div>
        <div class="field">
          <label for="st">Estado</label>
          <select id="st" class="select" name="st" [(ngModel)]="form.status">
            <option value="active">Activo</option>
            <option value="inactive">Inactivo</option>
            @if (editing()) {
              <option value="faulty">En falla</option>
            }
          </select>
        </div>
        @if (editing()) {
          <div class="field">
            <label for="veh">Instalado en (RF30 reasignar)</label>
            <select id="veh" class="select" name="veh" [(ngModel)]="form.vehicleId">
              <option [ngValue]="null">Ninguno (en bodega)</option>
              @for (v of vehicles(); track v.id) {
                <option [ngValue]="v.id" [disabled]="!!v.device && v.device.id !== editing()!.id">
                  {{ v.plate }}{{ v.device && v.device.id !== editing()!.id ? ' (tiene GPS)' : '' }}
                </option>
              }
            </select>
          </div>
        }
        <div class="field full">
          <label for="n">Notas</label
          ><textarea
            id="n"
            class="textarea"
            name="n"
            [(ngModel)]="form.notes"
            placeholder="Ubicación de instalación, SIM, observaciones…"
          ></textarea>
        </div>
        @if (formError()) {
          <div
            class="full badge red"
            style="height:auto;padding:8px 12px;white-space:normal;border-radius:12px"
            role="alert"
          >
            {{ formError() }}
          </div>
        }
        <button type="submit" hidden></button>
      </form>
    </app-sheet>

    <app-sheet [(open)]="keyOpen" title="Credencial del dispositivo" cancelText="Cerrar">
      <p class="footnote" style="margin-bottom:12px">
        Configura el equipo para enviar posiciones por HTTP POST a
        <span class="mono">/api/tracking/ingest</span> con esta cabecera:
      </p>
      <div class="card mono" style="word-break:break-all;font-size:13px">
        x-device-key: {{ apiKey() }}
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn" type="button" (click)="copy()">
          <app-icon name="copy" [size]="15" />Copiar
        </button>
        <button class="btn danger" type="button" (click)="regenerate()">
          <app-icon name="refresh" [size]="15" />Regenerar
        </button>
      </div>
      <pre class="card mono" style="margin-top:14px;font-size:12px;overflow:auto">{{ sample }}</pre>
    </app-sheet>
  `,
})
export class DevicesPage implements OnInit, OnDestroy {
  private api = inject(Api);
  readonly auth = inject(Auth);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  private live = inject(Live);
  readonly devices = signal<Device[]>([]);
  readonly vehicles = signal<Vehicle[]>([]);
  readonly loading = signal(true);
  readonly filter = signal('all');
  readonly sheetOpen = signal(false);
  readonly keyOpen = signal(false);
  readonly apiKey = signal('');
  readonly keyDevice = signal<Device | null>(null);
  readonly editing = signal<Device | null>(null);
  readonly busy = signal(false);
  readonly formError = signal('');
  readonly status = DEVICE_STATUS;
  readonly reasons = REASONS;
  readonly canWrite = computed(() => this.auth.can('devices', 'write'));
  readonly filterOptions = [
    { value: 'all', label: 'Todos' },
    { value: 'active', label: 'Activos' },
    { value: 'faulty', label: 'En falla' },
    { value: 'inactive', label: 'Inactivos' },
    { value: 'retired', label: 'Dados de baja' },
  ];
  readonly sample = `POST /api/tracking/ingest
Content-Type: application/json
x-device-key: <API key>

{ "lat": 6.2530, "lng": -75.5920, "speed": 32.5,
  "heading": 120, "battery": 88, "accuracy": 5,
  "ignition": true, "timestamp": "2026-10-12T15:04:05Z" }`;
  private sub?: Subscription;
  form: any = {};

  readonly shown = computed(() => {
    const f = this.filter();
    return this.devices().filter((d) =>
      f === 'all'
        ? d.status !== 'retired'
        : f === 'faulty'
          ? d.status === 'faulty' || (d.status === 'active' && d.connection === 'offline')
          : d.status === f,
    );
  });
  readonly stats = computed(() => {
    const live = this.devices().filter((d) => d.status !== 'retired');
    return {
      online: live.filter((d) => d.connection === 'online').length,
      failing: live.filter(
        (d) => d.status === 'faulty' || (d.status === 'active' && d.connection === 'offline'),
      ).length,
      inactive: live.filter((d) => d.status === 'inactive').length,
      free: live.filter((d) => !d.vehicle).length,
    };
  });

  async ngOnInit() {
    await this.load();
    this.sub = this.live.devices$.subscribe((ev) =>
      this.devices.update((l) =>
        l.map((d) =>
          d.id === ev.id ? { ...d, connection: ev.connection, lastSeenAt: ev.lastSeenAt } : d,
        ),
      ),
    );
  }
  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  async setFilter(f: string) {
    this.filter.set(f);
    if (f === 'retired') await this.load();
  }

  async load() {
    this.loading.set(true);
    try {
      const [d, v] = await Promise.all([
        this.api.get<Device[]>('devices', { includeRetired: true }),
        this.auth.can('vehicles') ? this.api.get<Vehicle[]>('vehicles') : Promise.resolve([]),
      ]);
      this.devices.set(d);
      this.vehicles.set(v);
    } catch (e) {
      this.toasts.error('No se pudieron cargar los dispositivos', errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  openCreate() {
    this.editing.set(null);
    this.form = { serial: '', model: '', status: 'active', notes: '' };
    this.formError.set('');
    this.sheetOpen.set(true);
  }

  openEdit(d: Device) {
    this.editing.set(d);
    this.form = {
      model: d.model,
      status: d.status,
      notes: d.notes,
      vehicleId: d.vehicle?.id ?? null,
    };
    this.formError.set('');
    this.sheetOpen.set(true);
  }

  async save() {
    this.busy.set(true);
    this.formError.set('');
    try {
      if (this.editing()) {
        await this.api.patch(`devices/${this.editing()!.id}`, this.form);
        this.toasts.success('Dispositivo actualizado');
        this.sheetOpen.set(false);
      } else {
        const d = await this.api.post<Device>('devices', this.form);
        this.sheetOpen.set(false);
        this.toasts.success(
          'Dispositivo registrado',
          'Guarda la API key para configurar el equipo.',
        );
        this.keyDevice.set(d);
        this.apiKey.set(d.apiKey ?? '');
        this.keyOpen.set(true);
      }
      await this.load();
    } catch (e) {
      this.formError.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async showKey(d: Device) {
    try {
      const full = await this.api.get<Device>(`devices/${d.id}`);
      this.keyDevice.set(full);
      this.apiKey.set(full.apiKey ?? '');
      this.keyOpen.set(true);
    } catch (e) {
      this.toasts.error('No se pudo obtener la credencial', errorMessage(e));
    }
  }

  async regenerate() {
    const d = this.keyDevice();
    if (!d) return;
    const ok = await this.confirm.ask({
      title: '¿Regenerar API key?',
      message: 'El equipo dejará de reportar hasta que lo configures con la nueva clave.',
      confirmText: 'Regenerar',
      destructive: true,
    });
    if (!ok) return;
    const r = await this.api.post<Device>(`devices/${d.id}/regenerate-key`);
    this.apiKey.set(r.apiKey ?? '');
    this.toasts.success('API key regenerada');
  }

  async copy() {
    try {
      await navigator.clipboard.writeText(this.apiKey());
      this.toasts.success('Copiada al portapapeles');
    } catch {
      this.toasts.info('Selecciona y copia la clave manualmente');
    }
  }

  /** RF31 – Baja por robo, daño o fin de vida útil. */
  async retire(d: Device) {
    const reason = await this.confirm.prompt({
      title: `¿Dar de baja ${d.serial}?`,
      message:
        'Se desinstalará del vehículo y dejará de aceptar posiciones. El histórico se conserva.',
      confirmText: 'Dar de baja',
      destructive: true,
      input: { options: Object.entries(REASONS).map(([value, label]) => ({ value, label })) },
    });
    if (!reason) return;
    try {
      await this.api.delete(`devices/${d.id}`, { reason });
      this.toasts.success('Dispositivo dado de baja');
      await this.load();
    } catch (e) {
      this.toasts.error('No se pudo dar de baja', errorMessage(e));
    }
  }
}
