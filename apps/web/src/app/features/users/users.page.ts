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
import { DtPipe, MODULE_LABELS, fmt } from '../../core/format';
import { Level, Module, PermissionMap, Role, User } from '../../core/models';
import { Confirm, Toasts } from '../../core/ui.services';
import {
  EmptyComponent,
  SegmentedComponent,
  SheetComponent,
  SkeletonListComponent,
} from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';
import { DebounceInputDirective } from '../../ui/motion-directives';
import { DetailComponent, DetailRow } from '../../ui/detail.component';

interface Meta {
  modules: Module[];
  roles: { id: Role; label: string; defaults: PermissionMap }[];
}

const ROLE_TONE: Record<string, string> = {
  owner: 'purple',
  admin: 'blue',
  supervisor: 'green',
  driver: 'orange',
  support: '',
};

/** RG9 / RF9-RF12 / RF32 – Usuarios, roles y permisos granulares por módulo. */
@Component({
  selector: 'app-users',
  imports: [
    DebounceInputDirective,
    FormsModule,
    IconComponent,
    SheetComponent,
    EmptyComponent,
    SkeletonListComponent,
    SegmentedComponent,
    DtPipe, DetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="eyebrow">Gestión</div>
          <h1 class="large-title">Usuarios y permisos</h1>
          <p>Quién puede entrar a WMS y qué puede hacer cada persona.</p>
        </div>
        <div class="actions">
          @if (canWrite()) {
            <button class="btn primary" type="button" (click)="openCreate()">
              <app-icon name="plus" [size]="16" />Nuevo usuario
            </button>
          }
        </div>
      </header>

      <div class="mod-tool">
        <div class="pills" role="group" aria-label="Filtrar por estado">
          @for (o of actOptions; track o.value) {
            <button type="button" [class.on]="actF() === o.value" [attr.aria-pressed]="actF() === o.value" (click)="actF.set(o.value)">{{ o.label }}@if (countAct(o.value)) {<small>{{ countAct(o.value) }}</small>}</button>
          }
        </div>
        <div class="mod-right">
          <span class="mod-count">{{ filtered().length }}{{ planMax() != null ? ' / ' + planMax() + ' usuarios de tu plan' : (filtered().length === 1 ? ' usuario' : ' usuarios') }}</span>
          <label class="search">
            <app-icon name="search" [size]="14" />
            <input class="input" type="search" placeholder="Buscar usuario" aria-label="Buscar usuario" [ngModel]="q()" wmsDebounce (debounced)="q.set($event)" />
          </label>
        </div>
      </div>

      @if (loading()) {
        <app-skeleton-list />
      } @else if (!filtered().length) {
        <div class="card">
          <app-empty
            icon="users"
            title="Sin usuarios"
            text="No hay usuarios que coincidan con la búsqueda."
          />
        </div>
      } @else {
        <div class="table-wrap" tabindex="0" role="region" aria-label="Tabla">
          <table class="table grid" style="--cols: minmax(0,2.2fr) minmax(0,1.3fr) minmax(0,1.2fr) 120px 140px; min-width: 780px">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Permisos</th>
                <th>Estado</th>
                <th>Último acceso</th>
              </tr>
            </thead>
            <tbody>
              @for (u of filtered(); track u.id) {
                <tr class="clickable" (click)="detail.set(u)">
                  <td data-label="Usuario">
                    <div class="cell">
                      <span class="av">{{ initials(u.name) }}</span>
                      <span class="cell-txt"
                        ><b>{{ u.name }}</b><small>{{ u.email }}{{ u.id === auth.user()?.id ? ' · tú' : '' }}</small></span
                      >
                    </div>
                  </td>
                  <td data-label="Rol"><span class="truncate">{{ u.roleLabel }}</span></td>
                  <td data-label="Permisos">
                    <span class="cell-txt"
                      ><span style="font-weight:500">{{ overrides(u) ? 'Personalizados' : 'Del rol' }}</span
                      ><small>{{ countAccess(u) }} módulos</small></span
                    >
                  </td>
                  <td data-label="Estado">
                    <span class="badge" [class.off]="!u.active">{{ u.active ? 'Activo' : 'Desactivado' }}</span>
                  </td>
                  <td data-label="Último acceso" class="muted">{{ u.lastLoginAt | dt: 'relative' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    @if (detail(); as u) {
      <app-detail
        [open]="true"
        (openChange)="!$event && detail.set(null)"
        [title]="u.name"
        [sub]="u.email"
        [ini]="initials(u.name)"
        [chip]="u.active ? 'Activo' : 'Inactivo'"
        [chipTone]="u.active ? 'on' : 'off'"
        [rows]="userRows(u)"
      >
        @if (canWrite() && u.id !== auth.user()?.id) {
          @if (u.role !== 'owner') {
            <button class="btn primary" type="button" (click)="detail.set(null); openPerms(u)"><app-icon name="shield" [size]="14" />Permisos</button>
          }
          <button class="btn" type="button" (click)="detail.set(null); openEdit(u)"><app-icon name="pencil" [size]="14" />Editar</button>
          <button class="btn" type="button" (click)="detail.set(null); resetPassword(u)"><app-icon name="key" [size]="14" />Restablecer contraseña</button>
          @if (u.role !== 'owner') {
            <button class="btn danger" type="button" (click)="detail.set(null); remove(u)"><app-icon name="trash" [size]="14" />Eliminar</button>
          }
        }
      </app-detail>
    }
    <app-sheet
      [(open)]="sheetOpen"
      [title]="editing() ? 'Editar usuario' : 'Nuevo usuario'"
      actionText="Guardar"
      [busy]="busy()"
      (action)="save()"
    >
      <form class="form-grid" (ngSubmit)="save()">
        <div class="field full">
          <label for="un">Nombre completo</label
          ><input id="un" class="input" name="un" [(ngModel)]="form.name" autocomplete="off" />
        </div>
        <div class="field">
          <label for="ue">Correo</label
          ><input
            id="ue"
            class="input"
            type="email"
            name="ue"
            [(ngModel)]="form.email"
            autocomplete="off"
          />
        </div>
        <div class="field">
          <label for="up">Teléfono</label
          ><input id="up" class="input" name="up" [(ngModel)]="form.phone" />
        </div>
        <div class="field">
          <label for="ur">Rol</label>
          <select id="ur" class="select" name="ur" [(ngModel)]="form.role">
            @for (r of assignableRoles(); track r.id) {
              <option [value]="r.id">{{ r.label }}</option>
            }
          </select>
        </div>
        @if (!editing()) {
          <div class="field">
            <label for="upw">Contraseña inicial</label
            ><input
              id="upw"
              class="input"
              type="password"
              name="upw"
              [(ngModel)]="form.password"
              autocomplete="new-password"
            /><span class="hint">8+ caracteres con letras y números</span>
          </div>
        } @else {
          <div class="field">
            <label for="ua">Estado</label>
            <select id="ua" class="select" name="ua" [(ngModel)]="form.active">
              <option [ngValue]="true">Activo</option>
              <option [ngValue]="false">Desactivado</option>
            </select>
          </div>
        }
        <p class="full footnote">{{ roleHelp[form.role] }}</p>
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
      [(open)]="permsOpen"
      [title]="'Permisos de ' + (permsUser()?.name ?? '')"
      actionText="Guardar"
      [busy]="busy()"
      (action)="savePerms()"
      [wide]="true"
    >
      <p class="footnote" style="margin-bottom:12px">
        Los permisos parten del rol <strong>{{ permsUser()?.roleLabel }}</strong
        >. Cambia cualquier módulo para personalizarlo; el punto naranja indica un valor distinto al
        del rol.
      </p>
      <div class="list">
        @for (m of modules(); track m) {
          <div class="list-item no-icon perm-row">
            <span class="content">
              <span class="title">{{ moduleLabels[m] }}</span>
              @if (perms[m] !== roleDefaults()[m]) {
                <span class="dot orange" style="margin-left:6px" title="Personalizado"></span>
              }
            </span>
            <app-segmented
              [options]="levelOptions"
              [value]="perms[m]"
              (valueChange)="perms[m] = $any($event)"
            />
          </div>
        }
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn sm" type="button" (click)="resetPerms()">
          <app-icon name="undo" [size]="14" />Restaurar valores del rol
        </button>
      </div>
    </app-sheet>
  `,
  styles: `
    .avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: 12px;
      font-weight: 600;
      color: var(--wms-text);
      border: 1px solid var(--wms-border);
      background: var(--wms-input);
      flex: none;
    }
    .perm-row {
      flex-wrap: wrap;
    }
    @media (max-width: 760px) {
      .perm-row app-segmented {
        width: 100%;
      }
    }
  `,
})
export class UsersPage implements OnInit {
  // --- Solo presentación (rediseño): panel Detalle ---
  readonly detail = signal<User | null>(null);
  userRows(u: User): DetailRow[] {
    return [
      { k: 'Rol', v: u.roleLabel },
      { k: 'Permisos', v: `${this.countAccess(u)} de ${this.modules().length} módulos${this.overrides(u) ? ' · ' + this.overrides(u) + ' personalizados' : ''}` },
      { k: 'Último acceso', v: fmt.relative(u.lastLoginAt) },
    ];
  }

  private api = inject(Api);
  readonly auth = inject(Auth);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  readonly users = signal<User[]>([]);
  readonly meta = signal<Meta | null>(null);
  readonly loading = signal(true);
  readonly q = signal('');
  readonly roleF = signal('all');
  readonly sheetOpen = signal(false);
  readonly permsOpen = signal(false);
  readonly editing = signal<User | null>(null);
  readonly permsUser = signal<User | null>(null);
  readonly busy = signal(false);
  readonly formError = signal('');
  readonly canWrite = computed(() => this.auth.can('users', 'write'));
  readonly roleTone = ROLE_TONE;
  readonly moduleLabels = MODULE_LABELS;
  readonly modules = computed(() => this.meta()?.modules ?? []);
  readonly levelOptions = [
    { value: 'none', label: 'Sin acceso' },
    { value: 'read', label: 'Lectura' },
    { value: 'write', label: 'Escritura' },
  ];
  readonly roleHelp: Record<string, string> = {
    owner: 'Responsable de la empresa: acceso total, incluida la suscripción y facturación.',
    admin: 'Administrador: gestiona flota, usuarios, alertas y reportes. Ve la facturación.',
    supervisor: 'Supervisor: monitorea, gestiona alertas, geocercas, conductores y reportes.',
    driver:
      'Conductor: ve su vehículo en el mapa, inicia/finaliza recorridos y envía alertas de emergencia.',
  };
  form: any = {};
  perms: Record<string, Level> = {};

  readonly roleFilterOptions = computed(() => [
    { value: 'all', label: 'Todos' },
    ...(this.meta()?.roles ?? []).map((r) => ({ value: r.id, label: r.label })),
  ]);
  readonly assignableRoles = computed(() =>
    (this.meta()?.roles ?? []).filter(
      (r) => r.id !== 'owner' || this.auth.user()?.role === 'owner',
    ),
  );
  readonly roleDefaults = computed(
    () =>
      this.meta()?.roles.find((r) => r.id === this.permsUser()?.role)?.defaults ??
      ({} as PermissionMap),
  );
  /** Filtro del prototipo por estado (el rol se busca escribiéndolo en el buscador). */
  readonly actF = signal<'all' | 'on' | 'off'>('all');
  readonly actOptions = [
    { value: 'all' as const, label: 'Todos' },
    { value: 'on' as const, label: 'Activos' },
    { value: 'off' as const, label: 'Desactivados' },
  ];
  /** Máximo de usuarios del plan (prototipo: "7 / 15 usuarios de tu plan"), si el rol puede ver la suscripción. */
  readonly planMax = signal<number | null>(null);
  private matchQ(u: User) {
    const q = this.q().trim().toLowerCase();
    return !q || [u.name, u.email, u.roleLabel].some((x) => (x ?? '').toLowerCase().includes(q));
  }
  countAct(f: 'all' | 'on' | 'off') {
    return this.users().filter((u) => this.matchQ(u) && (f === 'all' || (f === 'on' ? u.active : !u.active))).length;
  }
  readonly filtered = computed(() => {
    const f = this.actF();
    return this.users().filter(
      (u) =>
        (this.roleF() === 'all' || u.role === this.roleF()) &&
        (f === 'all' || (f === 'on' ? u.active : !u.active)) &&
        this.matchQ(u),
    );
  });

  /** Solo presentación (rediseño): conteo por rol para las píldoras. */
  countRole(r: string) {
    const q = this.q().trim().toLowerCase();
    return this.users().filter(
      (u) =>
        (r === 'all' || u.role === r) &&
        (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
    ).length;
  }
  initials = (n: string) =>
    n
      .split(' ')
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase();
  countAccess = (u: User) => Object.values(u.permissions).filter((l) => l !== 'none').length;
  overrides = (u: User) => Object.keys(u.permissionOverrides ?? {}).length;

  async ngOnInit() {
    this.meta.set(await this.api.get<Meta>('meta/permissions'));
    await this.load();
  }

  async load() {
    this.loading.set(true);
    try {
      this.users.set(await this.api.get<User[]>('users'));
      if (this.auth.can('billing') && this.planMax() == null)
        this.api.get<{ plan: { maxUsers: number } }>('subscription').then((r) => this.planMax.set(r.plan.maxUsers), () => {});
    } catch (e) {
      this.toasts.error('No se pudieron cargar los usuarios', errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  openCreate() {
    this.editing.set(null);
    this.form = { name: '', email: '', phone: '', role: 'supervisor', password: '' };
    this.formError.set('');
    this.sheetOpen.set(true);
  }

  openEdit(u: User) {
    this.editing.set(u);
    this.form = { name: u.name, email: u.email, phone: u.phone, role: u.role, active: u.active };
    this.formError.set('');
    this.sheetOpen.set(true);
  }

  async save() {
    this.busy.set(true);
    this.formError.set('');
    try {
      if (this.editing()) await this.api.patch(`users/${this.editing()!.id}`, this.form);
      else await this.api.post('users', this.form);
      this.toasts.success(
        this.editing() ? 'Usuario actualizado' : 'Usuario creado',
        this.form.email,
      );
      this.sheetOpen.set(false);
      await this.load();
    } catch (e) {
      this.formError.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  openPerms(u: User) {
    this.permsUser.set(u);
    this.perms = { ...u.permissions };
    this.permsOpen.set(true);
  }

  resetPerms() {
    this.perms = { ...this.roleDefaults() };
  }

  async savePerms() {
    const u = this.permsUser();
    if (!u) return;
    this.busy.set(true);
    try {
      await this.api.put(`users/${u.id}/permissions`, { permissions: this.perms });
      this.toasts.success('Permisos actualizados', u.name);
      this.permsOpen.set(false);
      await this.load();
    } catch (e) {
      this.toasts.error('No se pudieron guardar los permisos', errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async resetPassword(u: User) {
    const ok = await this.confirm.ask({
      title: `¿Restablecer la contraseña de ${u.name}?`,
      message: 'Se generará una contraseña temporal que deberás entregarle.',
      confirmText: 'Restablecer',
    });
    if (!ok) return;
    try {
      const r = await this.api.post<{ temporaryPassword: string }>(`users/${u.id}/reset-password`);
      await this.confirm.ask({
        title: 'Contraseña temporal',
        message: `${r.temporaryPassword}\n\nCompártela de forma segura; el usuario podrá cambiarla en Ajustes.`,
        confirmText: 'Listo',
        cancelText: 'Cerrar',
      });
    } catch (e) {
      this.toasts.error('No se pudo restablecer', errorMessage(e));
    }
  }

  async remove(u: User) {
    const ok = await this.confirm.ask({
      title: `¿Eliminar a ${u.name}?`,
      message: 'Perderá el acceso inmediatamente. Sus registros históricos se conservan.',
      confirmText: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(`users/${u.id}`);
      this.toasts.success('Usuario eliminado');
      await this.load();
    } catch (e) {
      this.toasts.error('No se pudo eliminar', errorMessage(e));
    }
  }
}
