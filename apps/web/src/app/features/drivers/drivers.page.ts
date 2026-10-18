import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { DtPipe, VEHICLE_TYPES } from '../../core/format';
import { Driver, Vehicle } from '../../core/models';
import { Confirm, Toasts } from '../../core/ui.services';
import { EmptyComponent, SheetComponent, SkeletonListComponent } from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';
import { DebounceInputDirective } from '../../ui/motion-directives';
import { DetailComponent, DetailRow } from '../../ui/detail.component';

const STATUS: Record<string, { label: string; tone: string }> = {
  disponible: { label: 'Disponible', tone: 'green' },
  en_ruta: { label: 'En ruta', tone: 'blue' },
  descanso: { label: 'Descanso', tone: 'orange' },
  inactivo: { label: 'Inactivo', tone: '' },
};

/** RE7 / HU8 – Registrar conductores y asociarlos a vehículos. */
@Component({
  selector: 'app-drivers',
  imports: [DebounceInputDirective, FormsModule, IconComponent, SheetComponent, EmptyComponent, SkeletonListComponent, DetailComponent, DtPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="eyebrow">Flota</div>
          <h1 class="large-title">Conductores</h1>
          <p>Personas que operan tus vehículos. Cada conductor tiene también una cuenta de acceso.</p>
        </div>
        <div class="actions">
          @if (canWrite()) {
            <button class="btn primary" type="button" (click)="openCreate()">
              <app-icon name="plus" [size]="14" />Nuevo conductor
            </button>
          }
        </div>
      </header>

      <div class="mod-tool">
        <div class="pills" role="tablist" aria-label="Estado">
          <button type="button" [class.on]="stF() === 'all'" (click)="stF.set('all')">Todos@if (base().length) {<small>{{ base().length }}</small>}</button>
          @for (k of statusKeys; track k) {
            <button type="button" [class.on]="stF() === k" (click)="stF.set(k)">{{ status[k].label }}@if (countSt(k)) {<small>{{ countSt(k) }}</small>}</button>
          }
        </div>
        <div class="mod-right">
          <span class="mod-count">{{ shown().length }} conductores</span>
          <label class="search">
            <app-icon name="search" [size]="14" />
            <input class="input" type="search" placeholder="Buscar conductor" aria-label="Buscar conductor" [value]="q()" wmsDebounce (debounced)="q.set($event)" />
          </label>
        </div>
      </div>

      @if (loading()) {
        <app-skeleton-list />
      } @else if (!drivers().length) {
        <div class="card">
          <app-empty
            icon="id-card"
            title="Aún no hay conductores"
            text="Registra a tus conductores para saber quién opera cada vehículo."
          />
        </div>
      } @else {
        <div class="table-wrap">
          <table class="table grid" style="--cols: minmax(0,2fr) 130px minmax(0,1.5fr) 120px 120px; min-width: 760px">
            <thead>
              <tr>
                <th>Conductor</th>
                <th>Teléfono</th>
                <th>Licencia</th>
                <th>Vehículo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              @for (d of shown(); track d.id) {
                <tr class="clickable" (click)="detail.set(d)">
                  <td data-label="Conductor">
                    <div class="cell">
                      <span class="av">{{ initials(d.name) }}</span>
                      <span class="cell-txt"><b>{{ d.name }}</b><small>{{ d.email }}</small></span>
                    </div>
                  </td>
                  <td data-label="Teléfono" class="tabular">{{ d.phone || '—' }}</td>
                  <td data-label="Licencia">
                    <span class="cell-txt"><span class="mono" style="font-weight:500">{{ d.licenseNumber || '—' }}</span><small>Cat. {{ d.licenseCategory }}{{ d.licenseExpiresAt ? ' · vence ' + (d.licenseExpiresAt | dt: 'short') : '' }}</small></span>
                  </td>
                  <td data-label="Vehículo">
                    @if (d.vehicle) {
                      <div class="cell">
                        <span class="tile"><app-icon [name]="types[d.vehicle.type].icon" [size]="15" /></span>
                        <b class="tabular">{{ d.vehicle.plate }}</b>
                      </div>
                    } @else {
                      <span class="muted">Sin asignar</span>
                    }
                  </td>
                  <td data-label="Estado">
                    <span class="badge" [class.solid]="d.status === 'en_ruta'" [class.off]="d.status === 'descanso' || d.status === 'inactivo'">{{ status[d.status].label }}</span>
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="5"><div class="empty"><h3>Sin conductores</h3>Ningún conductor coincide con el filtro.</div></td></tr>
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
        [title]="d.name"
        [sub]="d.email"
        [ini]="initials(d.name)"
        [chip]="status[d.status].label"
        [chipTone]="status[d.status].tone === 'green' ? 'solid' : status[d.status].tone ? 'on' : 'off'"
        [rows]="driverRows(d)"
      >
        @if (canWrite()) {
          <button class="btn primary" type="button" (click)="detail.set(null); openAssign(d)"><app-icon name="link" [size]="14" />Asignar vehículo</button>
          <button class="btn" type="button" (click)="detail.set(null); openEdit(d)"><app-icon name="pencil" [size]="14" />Editar</button>
          <button class="btn danger" type="button" (click)="detail.set(null); remove(d)"><app-icon name="trash" [size]="14" />Eliminar</button>
        }
      </app-detail>
    }
    <app-sheet
      [(open)]="sheetOpen"
      [title]="editing() ? 'Editar conductor' : 'Nuevo conductor'"
      actionText="Guardar"
      [busy]="busy()"
      (action)="save()"
    >
      <form class="form-grid" (ngSubmit)="save()">
        <div class="field full">
          <label for="n">Nombre completo</label
          ><input id="n" class="input" name="n" [(ngModel)]="form.name" />
        </div>
        @if (!editing()) {
          <div class="field">
            <label for="e">Correo (usuario de acceso)</label
            ><input id="e" class="input" type="email" name="e" [(ngModel)]="form.email" />
          </div>
          <div class="field">
            <label for="p">Contraseña inicial</label
            ><input
              id="p"
              class="input"
              type="password"
              name="p"
              [(ngModel)]="form.password"
              autocomplete="new-password"
            /><span class="hint">8+ caracteres con letras y números</span>
          </div>
        }
        <div class="field">
          <label for="t">Teléfono</label
          ><input
            id="t"
            class="input"
            name="t"
            [(ngModel)]="form.phone"
            placeholder="311 222 3344"
          />
        </div>
        <div class="field">
          <label for="doc">Documento</label
          ><input id="doc" class="input" name="doc" [(ngModel)]="form.document" />
        </div>
        <div class="field">
          <label for="lic">N.º de licencia</label
          ><input id="lic" class="input" name="lic" [(ngModel)]="form.licenseNumber" />
        </div>
        <div class="field">
          <label for="cat">Categoría</label>
          <select id="cat" class="select" name="cat" [(ngModel)]="form.licenseCategory">
            @for (c of categories; track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="exp">Vencimiento de licencia</label
          ><input
            id="exp"
            class="input"
            type="date"
            name="exp"
            [(ngModel)]="form.licenseExpiresAt"
          />
        </div>
        <div class="field">
          <label for="st">Estado</label>
          <select id="st" class="select" name="st" [(ngModel)]="form.status">
            @for (s of statusKeys; track s) {
              <option [value]="s">{{ status[s].label }}</option>
            }
          </select>
        </div>
        @if (!editing()) {
          <div class="field full">
            <label for="veh">Vehículo asignado</label>
            <select id="veh" class="select" name="veh" [(ngModel)]="form.vehicleId">
              <option [ngValue]="null">Sin vehículo</option>
              @for (v of vehicles(); track v.id) {
                <option [ngValue]="v.id">
                  {{ v.plate }} · {{ types[v.type].label
                  }}{{ v.driver ? ' (de ' + v.driver.name + ')' : '' }}
                </option>
              }
            </select>
          </div>
        }
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

    <app-sheet
      [(open)]="assignOpen"
      [title]="'Vehículo de ' + (assigning()?.name ?? '')"
      actionText="Asignar"
      [busy]="busy()"
      (action)="assign()"
    >
      <div class="list">
        <label class="list-item clickable no-icon">
          <input type="radio" name="av" [checked]="assignTo === null" (change)="assignTo = null" />
          <span class="content title">Sin vehículo</span>
        </label>
        @for (v of vehicles(); track v.id) {
          <label class="list-item clickable no-icon">
            <input
              type="radio"
              name="av"
              [checked]="assignTo === v.id"
              (change)="assignTo = v.id"
            />
            <span class="content"
              ><span class="title tabular">{{ v.plate }}</span>
              <span class="sub">· {{ types[v.type].label }} {{ v.brand }}</span></span
            >
            @if (v.driver && v.driver.id !== assigning()?.id) {
              <span class="caption">Actual: {{ v.driver.name }}</span>
            }
          </label>
        }
      </div>
      <p class="footnote" style="margin-top:10px">
        Un conductor opera un vehículo a la vez; si el vehículo ya tenía conductor, se reemplaza.
      </p>
    </app-sheet>
  `,
  styles: `
    .driver .avatar {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: 13px;
      font-weight: 600;
      color: var(--wms-text);
      border: 1px solid var(--wms-border);
      background: var(--wms-input);
      flex: none;
    }
    .driver .list-item {
      min-height: 40px;
      padding: 8px 0;
    }
  `,
})
export class DriversPage implements OnInit {
  // --- Solo presentación (rediseño): panel Detalle ---
  readonly detail = signal<Driver | null>(null);
  driverRows(d: Driver): DetailRow[] {
    return [
      { k: 'Teléfono', v: d.phone || '—' },
      { k: 'Licencia', v: `${d.licenseNumber || '—'} · Cat. ${d.licenseCategory}`, mono: true },
      { k: 'Vehículo', v: d.vehicle ? d.vehicle.plate : 'Sin asignar' },
      { k: 'Estado', v: this.status[d.status].label },
    ];
  }

  private api = inject(Api);
  readonly auth = inject(Auth);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  readonly drivers = signal<Driver[]>([]);
  readonly vehicles = signal<Vehicle[]>([]);
  readonly loading = signal(true);
  readonly sheetOpen = signal(false);
  readonly assignOpen = signal(false);
  readonly editing = signal<Driver | null>(null);
  readonly assigning = signal<Driver | null>(null);
  readonly busy = signal(false);
  readonly formError = signal('');
  readonly status = STATUS;
  readonly statusKeys = Object.keys(STATUS);
  readonly types = VEHICLE_TYPES;
  readonly categories = ['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
  readonly canWrite = computed(() => this.auth.can('drivers', 'write'));
  // --- Solo presentación (rediseño): búsqueda y filtro por estado sobre la lista ya cargada ---
  readonly q = signal('');
  readonly stF = signal('all');
  readonly base = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.drivers().filter(
      (d) => !q || [d.name, d.email, d.licenseNumber ?? ''].some((x) => (x ?? '').toLowerCase().includes(q)),
    );
  });
  readonly shown = computed(() => this.base().filter((d) => this.stF() === 'all' || d.status === this.stF()));
  countSt(k: string) {
    return this.base().filter((d) => d.status === k).length;
  }
  form: any = {};
  assignTo: string | null = null;

  initials = (n: string) =>
    n
      .split(' ')
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase();

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    try {
      const [d, v] = await Promise.all([
        this.api.get<Driver[]>('drivers'),
        this.api.get<Vehicle[]>('vehicles'),
      ]);
      this.drivers.set(d);
      this.vehicles.set(v);
    } catch (e) {
      this.toasts.error('No se pudieron cargar los conductores', errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  openCreate() {
    this.editing.set(null);
    this.form = {
      name: '',
      email: '',
      password: '',
      phone: '',
      document: '',
      licenseNumber: '',
      licenseCategory: 'A2',
      licenseExpiresAt: '',
      status: 'disponible',
      vehicleId: null,
    };
    this.formError.set('');
    this.sheetOpen.set(true);
  }

  openEdit(d: Driver) {
    this.editing.set(d);
    this.form = {
      name: d.name,
      phone: d.phone,
      document: d.document,
      licenseNumber: d.licenseNumber,
      licenseCategory: d.licenseCategory,
      licenseExpiresAt: d.licenseExpiresAt ?? '',
      status: d.status,
    };
    this.formError.set('');
    this.sheetOpen.set(true);
  }

  openAssign(d: Driver) {
    this.assigning.set(d);
    this.assignTo = d.vehicle?.id ?? null;
    this.assignOpen.set(true);
  }

  async save() {
    this.busy.set(true);
    this.formError.set('');
    const body = { ...this.form, licenseExpiresAt: this.form.licenseExpiresAt || null };
    try {
      if (this.editing()) await this.api.patch(`drivers/${this.editing()!.id}`, body);
      else await this.api.post('drivers', body);
      this.toasts.success(
        this.editing() ? 'Conductor actualizado' : 'Conductor registrado',
        body.name,
      );
      this.sheetOpen.set(false);
      await this.load();
    } catch (e) {
      this.formError.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async assign() {
    const d = this.assigning();
    if (!d) return;
    this.busy.set(true);
    try {
      await this.api.put(`drivers/${d.id}/vehicle`, { vehicleId: this.assignTo });
      this.toasts.success('Asignación actualizada');
      this.assignOpen.set(false);
      await this.load();
    } catch (e) {
      this.toasts.error('No se pudo asignar', errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async remove(d: Driver) {
    const ok = await this.confirm.ask({
      title: `¿Eliminar a ${d.name}?`,
      message: 'Se desactivará su acceso y se liberará su vehículo. El histórico se conserva.',
      confirmText: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(`drivers/${d.id}`);
      this.toasts.success('Conductor eliminado');
      await this.load();
    } catch (e) {
      this.toasts.error('No se pudo eliminar', errorMessage(e));
    }
  }
}
