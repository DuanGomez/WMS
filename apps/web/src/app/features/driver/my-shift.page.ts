import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { Api, errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { DtPipe, NumPipe, VEHICLE_TYPES } from '../../core/format';
import { Live } from '../../core/live.service';
import { Driver, Trip, Vehicle } from '../../core/models';
import { Confirm, Toasts } from '../../core/ui.services';
import { EmptyComponent } from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';

interface Me {
  driver: Driver;
  vehicle: Vehicle | null;
  trips: Trip[];
}

/** Conductor (Repartidor): iniciarRecorrido, finalizarRecorrido y enviarAlertaEmergencia del modelo de dominio. */
@Component({
  selector: 'app-my-shift',
  imports: [RouterLink, IconComponent, EmptyComponent, DtPipe, NumPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" style="max-width:760px">
      <header class="page-head">
        <div>
          <div class="eyebrow">Hola, {{ auth.user()?.name?.split(' ')?.[0] }}</div>
          <h1 class="large-title">Mi turno</h1>
        </div>
      </header>

      @if (me(); as m) {
        @if (m.vehicle; as v) {
          <section class="card hero">
            <div class="row">
              <span class="icon-tile lg bg-blue"
                ><app-icon [name]="types[v.type].icon" [size]="24"
              /></span>
              <div style="flex:1">
                <div class="title-1 tabular">{{ v.plate }}</div>
                <div class="footnote">{{ types[v.type].label }} · {{ v.brand }} {{ v.model }}</div>
              </div>
              <span
                class="badge"
                [class.green]="m.driver.shiftActive"
                [class.blue]="!m.driver.shiftActive"
                >{{ m.driver.shiftActive ? 'Turno activo' : 'Fuera de turno' }}</span
              >
            </div>
            <div class="metrics">
              <div>
                <span class="caption">Velocidad</span
                ><strong class="tabular">{{ speed() | num: 0 }} km/h</strong>
              </div>
              <div>
                <span class="caption">GPS</span
                ><strong [class.c-green]="online()" [class.c-red]="!online()">{{
                  online() ? 'En línea' : 'Sin señal'
                }}</strong>
              </div>
              <div>
                <span class="caption">Último reporte</span
                ><strong>{{ lastTs() | dt: 'relative' }}</strong>
              </div>
            </div>
            <div class="row" style="gap:10px">
              @if (m.driver.openTripId && m.driver.shiftActive) {
                <button
                  class="btn lg"
                  style="flex:1"
                  type="button"
                  (click)="finish()"
                  [disabled]="busy()"
                >
                  <app-icon name="circle-check" [size]="18" />Finalizar recorrido
                </button>
              } @else {
                <button
                  class="btn primary lg"
                  style="flex:1"
                  type="button"
                  (click)="start()"
                  [disabled]="busy()"
                >
                  <app-icon name="play" [size]="18" />Iniciar recorrido
                </button>
              }
              <a class="btn lg" routerLink="/mapa" [queryParams]="{ v: v.id }"
                ><app-icon name="map" [size]="18" />Mapa</a
              >
            </div>
          </section>

          <button
            class="sos"
            type="button"
            (click)="sos()"
            [disabled]="busy()"
            aria-label="Enviar alerta de emergencia"
          >
            <app-icon name="siren" [size]="28" />
            <span
              ><strong>Emergencia</strong
              ><small>Avisa de inmediato a tu empresa con tu ubicación</small></span
            >
          </button>

          <div class="section-label" style="margin-top:22px">Mis últimos recorridos</div>
          <div class="list">
            @for (t of m.trips; track t.id) {
              <div class="list-item">
                <span
                  class="icon-tile"
                  [class.bg-green]="t.status === 'open'"
                  [class.bg-gray]="t.status !== 'open'"
                  ><app-icon name="route" [size]="16"
                /></span>
                <span class="content">
                  <span class="title" style="display:block">{{ t.startedAt | dt }}</span>
                  <span class="sub"
                    >{{ t.distanceKm | num }} km · {{ t.movingMinutes }} min en marcha · máx
                    {{ t.maxSpeed }} km/h</span
                  >
                </span>
                @if (t.status === 'open') {
                  <span class="badge green">En curso</span>
                }
              </div>
            } @empty {
              <div class="list-item">
                <span class="content sub">Aún no tienes recorridos.</span>
              </div>
            }
          </div>
        } @else {
          <div class="card">
            <app-empty
              icon="car"
              title="Sin vehículo asignado"
              text="Pídele a tu administrador que te asigne un vehículo en Conductores."
            />
          </div>
        }
      } @else if (error()) {
        <div class="card">
          <app-empty icon="wifi-off" title="No pudimos cargar tu turno" [text]="error()" />
        </div>
      } @else {
        <div class="card"><div class="skeleton" style="height:180px"></div></div>
      }
    </div>
  `,
  styles: `
    .hero {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 22px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .metrics div {
      display: flex;
      flex-direction: column;
      padding: 10px 12px;
      border-radius: 14px;
      background: var(--fill-2);
    }
    .metrics strong {
      font-size: 17px;
    }
    .sos {
      margin-top: 16px;
      width: 100%;
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 18px 20px;
      border: 0;
      border-radius: 22px;
      background: linear-gradient(135deg, #ff453a, #ff2d55);
      color: #fff;
      cursor: pointer;
      text-align: left;
      box-shadow: 0 10px 30px rgba(255, 59, 48, 0.35);
      transition: transform 180ms var(--ease);
    }
    .sos:active {
      transform: scale(0.98);
    }
    .sos strong {
      display: block;
      font-size: 19px;
    }
    .sos small {
      opacity: 0.9;
      font-size: 13px;
    }
    @media (max-width: 520px) {
      .metrics {
        grid-template-columns: 1fr 1fr;
      }
    }
  `,
})
export class MyShiftPage implements OnInit, OnDestroy {
  private api = inject(Api);
  readonly auth = inject(Auth);
  private live = inject(Live);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  readonly me = signal<Me | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly speed = signal(0);
  readonly online = signal(false);
  readonly lastTs = signal<string | null>(null);
  readonly types = VEHICLE_TYPES;
  private sub?: Subscription;

  async ngOnInit() {
    await this.load();
    this.sub = this.live.positions$.subscribe((p) => {
      if (p.vehicleId !== this.me()?.vehicle?.id) return;
      this.speed.set(p.speed);
      this.online.set(true);
      this.lastTs.set(p.ts);
    });
  }
  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  async load() {
    try {
      const m = await this.api.get<Me>('me/driver');
      this.me.set(m);
      this.speed.set(m.vehicle?.live?.speed ?? 0);
      this.online.set(m.vehicle?.device?.connection === 'online');
      this.lastTs.set(m.vehicle?.live?.ts ?? null);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async start() {
    this.busy.set(true);
    try {
      await this.api.post('me/trip/start');
      this.toasts.success('Recorrido iniciado', '¡Buen viaje! Tu empresa puede verte en el mapa.');
      await this.load();
    } catch (e) {
      this.toasts.error('No se pudo iniciar', errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async finish() {
    this.busy.set(true);
    try {
      const t = await this.api.post<Trip>('me/trip/finish');
      this.toasts.success('Recorrido finalizado', `${t.distanceKm} km recorridos.`);
      await this.load();
    } catch (e) {
      this.toasts.error('No se pudo finalizar', errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async sos() {
    const msg = await this.confirm.prompt({
      title: '¿Enviar alerta de emergencia?',
      message: 'Se notificará de inmediato a los administradores con tu ubicación.',
      confirmText: 'Enviar',
      destructive: true,
      input: { placeholder: 'Mensaje opcional (ej. me están robando)' },
    });
    if (msg === null) return;
    this.busy.set(true);
    try {
      await this.api.post('me/emergency', { message: msg || undefined });
      this.toasts.show(
        {
          title: 'Alerta enviada',
          text: 'Tu empresa fue notificada. Mantén la calma; si estás en peligro llama al 123.',
          icon: 'siren',
          tone: 'red',
        },
        8000,
      );
    } catch (e) {
      this.toasts.error('No se pudo enviar', errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
