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
import { DebounceInputDirective } from '../../ui/motion-directives';

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
    DebounceInputDirective,
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
            Gestión
          </div>
          <h1 class="large-title">Soporte</h1>
          <p>
            {{
              isAgent()
                ? 'Tickets de todas las empresas de la plataforma.'
                : 'Escríbele al equipo de WMS; solemos responder el mismo día.'
            }}
          </p>
        </div>
        <div class="actions">
          @if (!isAgent()) {
            <button class="btn primary" type="button" (click)="openCreate()">
              <app-icon name="plus" [size]="16" />Nuevo ticket
            </button>
          }
        </div>
      </header>

      <div class="mod-tool">
        <div class="pills" role="group" aria-label="Filtrar por estado">
          @for (o of filterOptions; track o.value) {
            <button type="button" [class.on]="filter() === o.value" [attr.aria-pressed]="filter() === o.value" (click)="setFilter(o.value)">{{ o.label }}@if (countF(o.value)) {<small>{{ countF(o.value) }}</small>}</button>
          }
        </div>
        <div class="mod-right">
          <span class="mod-count">{{ shown().length }} tickets</span>
          <label class="search">
            <app-icon name="search" [size]="14" />
            <input class="input" type="search" placeholder="Buscar tickets" aria-label="Buscar tickets" [value]="q()" wmsDebounce (debounced)="q.set($event)" />
          </label>
        </div>
      </div>

      @if (loading()) {
        <app-skeleton-list />
      } @else if (!shown().length) {
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
        <div class="table-wrap" tabindex="0" role="region" aria-label="Tabla">
          <table class="table grid" style="--cols: 70px minmax(0,2.4fr) 110px 100px 120px 120px; min-width: 760px">
            <thead>
              <tr>
                <th>#</th>
                <th>Asunto</th>
                <th>Categoría</th>
                <th>Prioridad</th>
                <th>Estado</th>
                <th>Actualizado</th>
              </tr>
            </thead>
            <tbody>
              @for (t of shown(); track t.id) {
                <tr class="clickable" (click)="openTicket(t)">
                  <td data-label="#"><b class="mono">#{{ t.number }}</b></td>
                  <td data-label="Asunto">
                    <span class="cell-txt"
                      ><b>{{ t.subject }}</b
                      ><small
                        >{{ isAgent() ? t.companyName + ' · ' : '' }}{{ t.createdBy }} · {{ t.comments }} respuestas</small
                      ></span
                    >
                  </td>
                  <td data-label="Categoría">{{ categories[t.category] }}</td>
                  <td data-label="Prioridad">
                    <span class="badge" [class.solid]="t.priority === 'high' || t.priority === 'critical'" [class.off]="t.priority === 'low'">{{
                      priority[t.priority].label
                    }}</span>
                  </td>
                  <td data-label="Estado">
                    <span class="badge" [class.solid]="t.status === 'open'" [class.off]="t.status === 'resolved' || t.status === 'closed'">{{
                      status[t.status].label
                    }}</span>
                  </td>
                  <td data-label="Actualizado" class="muted">{{ t.updatedAt | dt: 'relative' }}</td>
                </tr>
              }
            </tbody>
          </table>
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
      border-radius: 16px;
      font-size: 13px;
      white-space: pre-wrap;
      animation: wms-in var(--dur-3) var(--ease) backwards;
    }
    .bubble .who {
      font-size: 11px;
      opacity: 0.75;
      margin-bottom: 2px;
    }
    .bubble.them {
      align-self: flex-start;
      background: var(--wms-card-hi);
      border: 1px solid var(--wms-border);
      border-bottom-left-radius: 6px;
    }
    .bubble.me {
      align-self: flex-end;
      background: var(--wms-solid);
      color: var(--wms-solid-text);
      border-bottom-right-radius: 6px;
    }
    /* Barra fija al pie del panel con fondo: transparente, los mensajes se veían a través de ella al desplazar el chat.
       El sticky se ancla al borde interno del padding de .sheet-body (24 px abajo, 20 px a los lados): se extiende
       sobre ese padding para que no quede un hueco por donde pase el texto. */
    .composer {
      display: flex;
      gap: 8px;
      position: sticky;
      bottom: -24px;
      margin: 0 -20px -24px;
      padding: 10px 20px 24px;
      background: var(--wms-panel), var(--wms-panel), var(--wms-panel);
      border-top: 1px solid var(--wms-divider);
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
  /** Filtros del prototipo (Abiertos agrupa abierto y en progreso; Resueltos agrupa resuelto y cerrado). */
  readonly filter = signal<'open' | 'done' | 'all'>('open');
  readonly q = signal('');
  private inGroup(t: Ticket, f: string) {
    const open = t.status === 'open' || t.status === 'in_progress';
    return f === 'all' || (f === 'open' ? open : !open);
  }
  private matchQ(t: Ticket) {
    const q = this.q().trim().toLowerCase();
    return !q || ('#' + t.number + ' ' + t.subject).toLowerCase().includes(q);
  }
  countF(f: string) {
    return this.tickets().filter((t) => this.matchQ(t) && this.inGroup(t, f)).length;
  }
  readonly shown = computed(() =>
    this.tickets()
      .filter((t) => this.matchQ(t) && this.inGroup(t, this.filter()))
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1)),
  );
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
    { value: 'open' as const, label: 'Abiertos' },
    { value: 'done' as const, label: 'Resueltos' },
    { value: 'all' as const, label: 'Todos' },
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
        await this.api.get<Ticket[]>('tickets'),
      );
    } catch (e) {
      this.toasts.error('No se pudieron cargar los tickets', errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  setFilter(f: 'open' | 'done' | 'all') {
    this.filter.set(f);
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
