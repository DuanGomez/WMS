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
import { DtPipe, MODULE_LABELS } from '../../core/format';
import { Level, Module, PermissionMap, Role, User } from '../../core/models';
import { Confirm, Toasts } from '../../core/ui.services';
import {
  EmptyComponent,
  SegmentedComponent,
  SheetComponent,
  SkeletonListComponent,
} from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';

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
          <div class="eyebrow">Gestión</div>
          <h1 class="large-title">Usuarios y permisos</h1>
        </div>
        <div class="actions">
          @if (canWrite()) {
            <button class="btn primary" type="button" (click)="openCreate()">
              <app-icon name="plus" [size]="16" />Nuevo usuario
            </button>
          }
        </div>
      </header>

      <div class="row wrap" style="margin-bottom:14px">
        <label class="search" style="flex:1;max-width:360px;min-width:220px">
          <app-icon name="search" [size]="16" />
          <input
            class="input"
            type="search"
            placeholder="Buscar por nombre o correo"
            aria-label="Buscar usuarios"
            [ngModel]="q()"
            (ngModelChange)="q.set($event)"
          />
        </label>
        <app-segmented
          [options]="roleFilterOptions()"
          [value]="roleF()"
          (valueChange)="roleF.set($event)"
        />
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
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Permisos</th>
                <th>Estado</th>
                <th>Último acceso</th>
                <th class="actions-cell"><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (u of filtered(); track u.id) {
                <tr>
                  <td>
                    <div class="row">
                      <div class="avatar">{{ initials(u.name) }}</div>
                      <div style="min-width:0">
                        <div style="font-weight:600">
                          {{ u.name }}{{ u.id === auth.user()?.id ? ' (tú)' : '' }}
                        </div>
                        <div class="caption">{{ u.email }}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="badge" [class]="'badge ' + roleTone[u.role]">{{
                      u.roleLabel
                    }}</span>
                  </td>
                  <td class="caption">
                    {{ countAccess(u) }} de {{ modules().length }} módulos
                    @if (overrides(u)) {
                      <span class="badge orange" style="margin-left:4px"
                        >{{ overrides(u) }} personalizados</span
                      >
                    }
                  </td>
                  <td>
                    <span class="row" style="gap:6px"
                      ><span class="dot" [class.green]="u.active"></span
                      >{{ u.active ? 'Activo' : 'Inactivo' }}</span
                    >
                  </td>
                  <td class="caption">{{ u.lastLoginAt | dt: 'relative' }}</td>
                  <td class="actions-cell">
                    @if (canWrite() && u.id !== auth.user()?.id) {
                      @if (u.role !== 'owner') {
                        <button
                          class="btn sm icon plain"
                          type="button"
                          title="Permisos"
                          aria-label="Permisos granulares"
                          (click)="openPerms(u)"
                        >
                          <app-icon name="shield" [size]="16" />
                        </button>
                      }
                      <button
                        class="btn sm icon plain"
                        type="button"
                        title="Editar"
                        aria-label="Editar usuario"
                        (click)="openEdit(u)"
                      >
                        <app-icon name="pencil" [size]="16" />
                      </button>
                      <button
                        class="btn sm icon plain"
                        type="button"
                        title="Restablecer contraseña"
                        aria-label="Restablecer contraseña"
                        (click)="resetPassword(u)"
                      >
                        <app-icon name="key" [size]="16" />
                      </button>
                      @if (u.role !== 'owner') {
                        <button
                          class="btn sm icon plain danger"
                          type="button"
                          title="Eliminar"
                          aria-label="Eliminar usuario"
                          (click)="remove(u)"
                        >
                          <app-icon name="trash" [size]="16" />
                        </button>
                      }
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
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      background: linear-gradient(135deg, var(--indigo), var(--purple));
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
  readonly filtered = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.users().filter(
      (u) =>
        (this.roleF() === 'all' || u.role === this.roleF()) &&
        (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
    );
  });

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
