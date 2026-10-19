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
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { Api, errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { DEVICE_STATUS, DtPipe, fmt } from '../../core/format';
import { Live } from '../../core/live.service';
import { Device, Vehicle } from '../../core/models';
import { Confirm, Toasts } from '../../core/ui.services';
import {
  EmptyComponent,
  SheetComponent,
  SkeletonListComponent,
} from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';
import { DebounceInputDirective, MorphWidthDirective } from '../../ui/motion-directives';
import { DetailComponent, DetailRow } from '../../ui/detail.component';

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
    MorphWidthDirective,
    DebounceInputDirective,
    FormsModule,
    IconComponent,
    SheetComponent,
    EmptyComponent,
    SkeletonListComponent,
    DtPipe, DetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="eyebrow">Flota</div>
          <h1 class="large-title">Dispositivos GPS</h1>
          <p>Equipos GPS que reportan posiciones a WMS.</p>
        </div>
        <div class="actions">
          @if (canWrite()) {
            <button class="btn primary" type="button" (click)="openCreate()">
              <app-icon name="plus" [size]="16" />Registrar dispositivo
            </button>
          }
        </div>
      </header>

      <div class="mod-tool">
        <div class="pills" role="tablist" aria-label="Filtro">
          @for (o of filterOptions; track o.value) {
            <button type="button" [class.on]="filter() === o.value" (click)="setFilter(o.value)">{{ o.label }}@if (countF(o.value)) {<small>{{ countF(o.value) }}</small>}</button>
          }
        </div>
        <div class="mod-right">
          <span class="mod-count">{{ shownQ().length }} {{ shownQ().length === 1 ? 'dispositivo' : 'dispositivos' }}</span>
          <label class="search">
            <app-icon name="search" [size]="14" />
            <input class="input" type="search" placeholder="Buscar serial o modelo" aria-label="Buscar serial o modelo" [value]="q()" wmsDebounce (debounced)="q.set($event)" />
          </label>
        </div>
      </div>

      @if (loading()) {
        <app-skeleton-list />
      } @else if (!shownQ().length) {
        <div class="card">
          <app-empty
            icon="satellite-dish"
            title="Sin dispositivos"
            text="Registra los equipos GPS con su serial/IMEI; luego instálalos en un vehículo."
          />
        </div>
      } @else {
        <div class="table-wrap">
          <table class="table grid" style="--cols: minmax(0,2fr) 120px 120px 130px 110px 130px; min-width: 820px">
            <thead>
              <tr>
                <th>Serial / IMEI</th>
                <th>Estado</th>
                <th>Conexión</th>
                <th>Batería</th>
                <th>Vehículo</th>
                <th>Último reporte</th>
              </tr>
            </thead>
            <tbody>
              @for (d of shownQ(); track d.id) {
                <tr class="clickable" (click)="detail.set(d)">
                  <td data-label="Serial / IMEI">
                    <div class="cell">
                      <span class="tile" [class.solid]="d.connection === 'online' && d.status !== 'retired'" [class.muted]="d.status === 'retired'"><app-icon name="satellite-dish" [size]="15" /></span>
                      <span class="cell-txt"><b class="mono">{{ d.serial }}</b><small>{{ d.model }}</small></span>
                    </div>
                  </td>
                  <td data-label="Estado">
                    <!-- El motivo de baja va en el título y en el panel de detalle (la celda solo lleva el chip, como el prototipo) -->
                    <span class="badge" [class.solid]="d.status === 'faulty'" [class.off]="d.status !== 'active' && d.status !== 'faulty'" [attr.title]="d.retiredReason ? 'Motivo: ' + (reasons[d.retiredReason] ?? d.retiredReason) : null">{{
                      status[d.status].label
                    }}</span>
                  </td>
                  <td data-label="Conexión">
                    <span class="badge" [class.solid]="d.connection === 'online'" [class.off]="d.connection !== 'online'"
                      >{{
                        d.connection === 'online'
                          ? 'En línea'
                          : d.connection === 'offline'
                            ? 'Sin señal'
                            : 'Sin datos'
                      }}</span
                    >
                  </td>
                  <td data-label="Batería" class="tabular">
                    @if (d.battery != null) {
                      <span class="barcell" [class.low]="d.battery < 20"><b>{{ d.battery }}%</b><i><span [style.width.%]="d.battery" wmsMorphWidth></span></i></span>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td data-label="Vehículo"><b class="tabular" [class.muted]="!d.vehicle">{{ d.vehicle?.plate ?? '—' }}</b></td>
                  <td data-label="Último reporte" class="muted">{{ d.lastSeenAt | dt: 'relative' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    @if (detail(); as d) {
      <app-detail
        [open]="true"
        (openChange)="!$event && detail.set(null)"
        [title]="d.serial"
        [sub]="d.model"
        icon="satellite-dish"
        [chip]="d.connection === 'online' ? 'En línea' : d.connection === 'offline' ? 'Sin señal' : 'Sin datos'"
        [chipTone]="d.connection === 'online' ? 'solid' : 'off'"
        [rows]="deviceRows(d)"
      >
        @if (canWrite() && d.status !== 'retired') {
          <button class="btn primary" type="button" (click)="detail.set(null); openEdit(d)"><app-icon name="pencil" [size]="14" />Editar / reasignar</button>
          <button class="btn" type="button" (click)="detail.set(null); showKey(d)"><app-icon name="key" [size]="14" />Ver API key</button>
          <button class="btn danger" type="button" (click)="detail.set(null); retire(d)"><app-icon name="trash" [size]="14" />Dar de baja</button>
        }
      </app-detail>
    }
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
  // --- Solo presentación (rediseño): panel Detalle ---
  readonly detail = signal<Device | null>(null);
  deviceRows(d: Device): DetailRow[] {
    return [
      { k: 'Estado', v: this.status[d.status].label },
      { k: 'Batería', v: d.battery != null ? d.battery + '%' : '—' },
      { k: 'Vehículo', v: d.vehicle?.plate ?? 'Ninguno (en bodega)' },
      { k: 'Último reporte', v: fmt.relative(d.lastSeenAt) },
      ...(d.retiredReason ? [{ k: 'Motivo de baja', v: this.reasons[d.retiredReason] ?? d.retiredReason }] : []),
    ];
  }

  private api = inject(Api);
  readonly auth = inject(Auth);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  private live = inject(Live);
  private destroyRef = inject(DestroyRef);
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
  /** Filtros del prototipo (los dados de baja se ven en Todos e Inactivos). */
  readonly filterOptions = [
    { value: 'all', label: 'Todos' },
    { value: 'online', label: 'En línea' },
    { value: 'fail', label: 'Sin señal / en falla' },
    { value: 'inactive', label: 'Inactivos' },
    { value: 'free', label: 'Sin vehículo' },
  ];
  private matches(d: Device, f: string) {
    switch (f) {
      case 'online':
        return d.connection === 'online' && d.status !== 'retired';
      case 'fail':
        return d.status === 'faulty' || (d.status === 'active' && d.connection !== 'online');
      case 'inactive':
        return d.status === 'inactive' || d.status === 'retired';
      case 'free':
        return !d.vehicle && d.status !== 'retired';
      default:
        return true;
    }
  }
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
    return this.devices().filter((d) => this.matches(d, f));
  });
  // --- Solo presentación (rediseño): búsqueda y conteo por filtro sobre la lista ya cargada ---
  readonly q = signal('');
  readonly shownQ = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.shown().filter(
      (d) => !q || [d.serial, d.model, d.vehicle?.plate ?? ''].some((x) => (x ?? '').toLowerCase().includes(q)),
    );
  });
  countF(f: string) {
    const q = this.q().trim().toLowerCase();
    return this.devices().filter(
      (d) => this.matches(d, f) && (!q || [d.serial, d.model, d.vehicle?.plate ?? ''].some((x) => (x ?? '').toLowerCase().includes(q))),
    ).length;
  }
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
    // Si se salió de la vista mientras cargaba, no se abre la suscripción (quedaría viva).
    if (this.destroyRef.destroyed) return;
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
