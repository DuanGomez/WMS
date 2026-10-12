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
import { VEHICLE_TYPES } from '../../core/format';
import { Driver, Vehicle } from '../../core/models';
import { Confirm, Toasts } from '../../core/ui.services';
import { EmptyComponent, SheetComponent, SkeletonListComponent } from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';

const STATUS: Record<string, { label: string; tone: string }> = {
  disponible: { label: 'Disponible', tone: 'green' },
  en_ruta: { label: 'En ruta', tone: 'blue' },
  descanso: { label: 'Descanso', tone: 'orange' },
  inactivo: { label: 'Inactivo', tone: '' },
};

/** RE7 / HU8 – Registrar conductores y asociarlos a vehículos. */
@Component({
  selector: 'app-drivers',
  imports: [FormsModule, IconComponent, SheetComponent, EmptyComponent, SkeletonListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="eyebrow">Flota</div>
          <h1 class="large-title">Conductores</h1>
        </div>
        <div class="actions">
          @if (canWrite()) {
            <button class="btn primary" type="button" (click)="openCreate()">
              <app-icon name="plus" [size]="16" />Nuevo conductor
            </button>
          }
        </div>
      </header>

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
        <div class="grid grid-3">
          @for (d of drivers(); track d.id) {
            <article class="card driver">
              <div class="row">
                <div class="avatar">{{ initials(d.name) }}</div>
                <div style="min-width:0;flex:1">
                  <div class="headline truncate">{{ d.name }}</div>
                  <div class="caption truncate">{{ d.email }}</div>
                </div>
                <span class="badge" [class]="'badge ' + status[d.status].tone">{{
                  status[d.status].label
                }}</span>
              </div>
              <div class="list flat" style="margin-top:12px;box-shadow:none">
                <div class="list-item no-icon">
                  <span class="content sub">Teléfono</span
                  ><span class="tabular">{{ d.phone || '—' }}</span>
                </div>
                <div class="list-item no-icon">
                  <span class="content sub">Licencia</span
                  ><span class="tabular"
                    >{{ d.licenseCategory }} · {{ d.licenseNumber || '—' }}</span
                  >
                </div>
                <div class="list-item no-icon">
                  <span class="content sub">Vehículo</span>
                  @if (d.vehicle) {
                    <span class="row" style="gap:6px"
                      ><app-icon [name]="types[d.vehicle.type].icon" [size]="15" /><strong
                        class="tabular"
                        >{{ d.vehicle.plate }}</strong
                      ></span
                    >
                  } @else {
                    <span class="muted">Sin asignar</span>
                  }
                </div>
              </div>
              @if (canWrite()) {
                <div class="row" style="margin-top:12px">
                  <button class="btn sm" style="flex:1" type="button" (click)="openAssign(d)">
                    <app-icon name="link" [size]="14" />Asignar vehículo
                  </button>
                  <button
                    class="btn sm icon"
                    type="button"
                    aria-label="Editar conductor"
                    (click)="openEdit(d)"
                  >
                    <app-icon name="pencil" [size]="14" />
                  </button>
                  <button
                    class="btn sm icon danger"
                    type="button"
                    aria-label="Eliminar conductor"
                    (click)="remove(d)"
                  >
                    <app-icon name="trash" [size]="14" />
                  </button>
                </div>
              }
            </article>
          }
        </div>
      }
    </div>

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
      font-weight: 600;
      color: #fff;
      background: linear-gradient(135deg, var(--teal), var(--blue));
      flex: none;
    }
    .driver .list-item {
      min-height: 40px;
      padding: 8px 0;
    }
  `,
})
export class DriversPage implements OnInit {
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
