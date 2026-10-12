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
import { DtPipe, PRIORITY } from '../../core/format';
import { Ticket } from '../../core/models';
import { Toasts } from '../../core/ui.services';
import {
  EmptyComponent,
  SegmentedComponent,
  SheetComponent,
  SkeletonListComponent,
} from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';

const STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: 'Abierto', tone: 'blue' },
  in_progress: { label: 'En progreso', tone: 'orange' },
  resolved: { label: 'Resuelto', tone: 'green' },
  closed: { label: 'Cerrado', tone: '' },
};
const CATEGORIES: Record<string, string> = {
  general: 'General',
  gps: 'Dispositivo GPS',
  facturacion: 'Facturación',
  cuenta: 'Cuenta y acceso',
  mapa: 'Mapa',
  reportes: 'Reportes',
};

/** Actor «Agente de soporte»: gestión de tickets (crear, listar, cambiar estado, conversar). */
@Component({
  selector: 'app-support',
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
          <div class="eyebrow">
            {{ isAgent() ? 'Mesa de ayuda WMS · todas las empresas' : 'Ayuda' }}
          </div>
          <h1 class="large-title">Soporte</h1>
        </div>
        <div class="actions">
          @if (!isAgent()) {
            <button class="btn primary" type="button" (click)="openCreate()">
              <app-icon name="plus" [size]="16" />Nuevo ticket
            </button>
          }
        </div>
      </header>

      <app-segmented
        [options]="filterOptions"
        [value]="filter()"
        (valueChange)="setFilter($event)"
        style="display:block;margin-bottom:14px"
      />

      @if (loading()) {
        <app-skeleton-list />
      } @else if (!tickets().length) {
        <div class="card">
          <app-empty
            icon="life-buoy"
            title="Sin tickets"
            [text]="
              isAgent()
                ? 'No hay tickets en este estado.'
                : '¿Necesitas ayuda? Crea un ticket y te responderemos pronto.'
            "
          />
        </div>
      } @else {
        <div class="list">
          @for (t of tickets(); track t.id) {
            <button class="list-item" type="button" (click)="openTicket(t)">
              <span class="icon-tile" [class]="'icon-tile bg-' + (status[t.status].tone || 'gray')"
                ><app-icon name="message" [size]="16"
              /></span>
              <span class="content">
                <span class="row" style="gap:8px"
                  ><span class="title truncate">#{{ t.number }} · {{ t.subject }}</span></span
                >
                <span class="sub" style="display:block">
                  @if (isAgent()) {
                    <strong>{{ t.companyName }}</strong> ·
                  }
                  {{ categories[t.category] }} · {{ t.createdBy }} ·
                  {{ t.updatedAt | dt: 'relative' }} · {{ t.comments }} respuestas
                </span>
              </span>
              <span class="badge" [class]="'badge ' + priority[t.priority].tone">{{
                priority[t.priority].label
              }}</span>
              <span class="badge" [class]="'badge ' + status[t.status].tone">{{
                status[t.status].label
              }}</span>
            </button>
          }
        </div>
      }
    </div>

    <app-sheet
      [(open)]="createOpen"
      title="Nuevo ticket"
      actionText="Enviar"
      [busy]="busy()"
      (action)="create()"
    >
      <form class="form-grid" (ngSubmit)="create()">
        <div class="field full">
          <label for="ts">Asunto</label
          ><input
            id="ts"
            class="input"
            name="ts"
            [(ngModel)]="form.subject"
            placeholder="El GPS de la moto no reporta"
          />
        </div>
        <div class="field">
          <label for="tc">Categoría</label>
          <select id="tc" class="select" name="tc" [(ngModel)]="form.category">
            @for (c of categoryKeys; track c) {
              <option [value]="c">{{ categories[c] }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="tp">Prioridad</label>
          <select id="tp" class="select" name="tp" [(ngModel)]="form.priority">
            @for (p of ['low', 'medium', 'high', 'critical']; track p) {
              <option [value]="p">{{ priority[p].label }}</option>
            }
          </select>
        </div>
        <div class="field full">
          <label for="td">Descripción</label
          ><textarea
            id="td"
            class="textarea"
            name="td"
            [(ngModel)]="form.description"
            placeholder="Cuéntanos qué pasó, desde cuándo y en qué vehículo."
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

    <app-sheet
      [(open)]="detailOpen"
      [title]="current() ? '#' + current()!.number : ''"
      cancelText="Cerrar"
    >
      @if (current(); as t) {
        <h2 class="title-3">{{ t.subject }}</h2>
        <p class="caption" style="margin:4px 0 12px">
          {{ t.companyName }} · {{ categories[t.category] }} · {{ t.createdAt | dt }}
        </p>
        <div class="row wrap" style="margin-bottom:14px">
          @if (isAgent()) {
            <app-segmented
              [options]="statusOptions"
              [value]="t.status"
              (valueChange)="setStatus($event)"
            />
            @if (!t.assignedTo) {
              <button class="btn sm" type="button" (click)="assignMe()">Asignarme</button>
            } @else {
              <span class="caption">Asignado a {{ t.assignedTo }}</span>
            }
          } @else {
            <span class="badge" [class]="'badge ' + status[t.status].tone">{{
              status[t.status].label
            }}</span>
            <span class="spacer"></span>
            @if (t.status !== 'closed') {
              <button class="btn sm" type="button" (click)="setStatus('closed')">
                Cerrar ticket
              </button>
            } @else {
              <button class="btn sm" type="button" (click)="setStatus('open')">Reabrir</button>
            }
          }
        </div>
        <div class="thread">
          <div class="bubble them">
            <div class="who">{{ t.createdBy }}</div>
            {{ t.description }}
          </div>
          @for (c of t.thread ?? []; track c.id) {
            <div
              class="bubble"
              [class.me]="c.isAgent === isAgent()"
              [class.them]="c.isAgent !== isAgent()"
            >
              <div class="who">
                {{ c.author }}{{ c.isAgent ? ' · Soporte WMS' : '' }} ·
                {{ c.createdAt | dt: 'relative' }}
              </div>
              {{ c.body }}
            </div>
          }
        </div>
        @if (t.status !== 'closed') {
          <form class="composer" (ngSubmit)="comment()">
            <input
              class="input"
              name="c"
              [(ngModel)]="reply"
              placeholder="Escribe una respuesta…"
              aria-label="Respuesta"
            />
            <button
              class="btn primary icon"
              type="submit"
              [disabled]="!reply.trim() || busy()"
              aria-label="Enviar"
            >
              <app-icon name="send" [size]="16" />
            </button>
          </form>
        }
      }
    </app-sheet>
  `,
  styles: `
    .thread {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 14px;
    }
    .bubble {
      max-width: 82%;
      padding: 9px 13px;
      border-radius: 18px;
      font-size: 15px;
      white-space: pre-wrap;
    }
    .bubble .who {
      font-size: 11px;
      opacity: 0.75;
      margin-bottom: 2px;
    }
    .bubble.them {
      align-self: flex-start;
      background: var(--bg-elevated);
      border: 0.5px solid var(--hairline);
      border-bottom-left-radius: 6px;
    }
    .bubble.me {
      align-self: flex-end;
      background: var(--tint);
      color: #fff;
      border-bottom-right-radius: 6px;
    }
    .composer {
      display: flex;
      gap: 8px;
      position: sticky;
      bottom: 0;
      padding-top: 8px;
      background: var(--bg);
    }
    .composer .input {
      border-radius: 999px;
    }
  `,
})
export class SupportPage implements OnInit {
  private api = inject(Api);
  readonly auth = inject(Auth);
  private toasts = inject(Toasts);
  readonly tickets = signal<Ticket[]>([]);
  readonly loading = signal(true);
  readonly filter = signal('');
  readonly createOpen = signal(false);
  readonly detailOpen = signal(false);
  readonly current = signal<Ticket | null>(null);
  readonly busy = signal(false);
  readonly formError = signal('');
  readonly status = STATUS;
  readonly priority = PRIORITY;
  readonly categories = CATEGORIES;
  readonly categoryKeys = Object.keys(CATEGORIES);
  readonly isAgent = computed(() => this.auth.user()?.role === 'support');
  readonly filterOptions = [
    { value: '', label: 'Todos' },
    { value: 'open', label: 'Abiertos' },
    { value: 'in_progress', label: 'En progreso' },
    { value: 'resolved', label: 'Resueltos' },
    { value: 'closed', label: 'Cerrados' },
  ];
  readonly statusOptions = Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }));
  form = { subject: '', category: 'general', priority: 'medium', description: '' };
  reply = '';

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    try {
      this.tickets.set(
        await this.api.get<Ticket[]>('tickets', { status: this.filter() || undefined }),
      );
    } catch (e) {
      this.toasts.error('No se pudieron cargar los tickets', errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  setFilter(f: string) {
    this.filter.set(f);
    this.load();
  }

  openCreate() {
    this.form = { subject: '', category: 'general', priority: 'medium', description: '' };
    this.formError.set('');
    this.createOpen.set(true);
  }

  async create() {
    this.busy.set(true);
    this.formError.set('');
    try {
      const t = await this.api.post<Ticket>('tickets', this.form);
      this.toasts.success(
        `Ticket #${t.number} creado`,
        'Un agente de soporte te responderá pronto.',
      );
      this.createOpen.set(false);
      await this.load();
    } catch (e) {
      this.formError.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async openTicket(t: Ticket) {
    this.current.set(await this.api.get<Ticket>(`tickets/${t.id}`));
    this.reply = '';
    this.detailOpen.set(true);
  }

  private async refreshCurrent() {
    const t = this.current();
    if (t) this.current.set(await this.api.get<Ticket>(`tickets/${t.id}`));
    await this.load();
  }

  async setStatus(status: string) {
    const t = this.current();
    if (!t) return;
    await this.api.patch(`tickets/${t.id}`, { status });
    this.toasts.success('Estado actualizado', STATUS[status].label);
    await this.refreshCurrent();
  }

  async assignMe() {
    const t = this.current();
    if (!t) return;
    await this.api.patch(`tickets/${t.id}`, {
      assignToMe: true,
      status: t.status === 'open' ? 'in_progress' : undefined,
    });
    await this.refreshCurrent();
  }

  async comment() {
    const t = this.current();
    if (!t || !this.reply.trim()) return;
    this.busy.set(true);
    try {
      await this.api.post(`tickets/${t.id}/comments`, { body: this.reply });
      this.reply = '';
      await this.refreshCurrent();
    } catch (e) {
      this.toasts.error('No se pudo enviar', errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
