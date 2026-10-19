import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { Api, errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { DtPipe, NumPipe, VEHICLE_TYPES } from '../../core/format';
import { Live } from '../../core/live.service';
import { DriverLocation, ShareStatus } from '../../core/driver-location.service';
import { Driver, Trip, Vehicle } from '../../core/models';
import { Confirm, Toasts } from '../../core/ui.services';
import { EmptyComponent, ToggleComponent } from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';
import { CountDirective } from '../../ui/wms-fx';

interface Me {
  driver: Driver;
  vehicle: Vehicle | null;
  trips: Trip[];
}

const SHARE_LABELS: Record<ShareStatus, string> = {
  idle: 'Inactiva',
  requesting: 'Esperando permiso…',
  active: 'Compartiendo en vivo',
  paused: 'En pausa',
  denied: 'Permiso denegado',
  unavailable: 'No disponible en este dispositivo',
  insecure: 'Requiere HTTPS',
  error: 'Buscando señal…',
};

/** Conductor (Repartidor): iniciarRecorrido, finalizarRecorrido y enviarAlertaEmergencia del modelo de dominio. */
@Component({
  selector: 'app-my-shift',
  imports: [RouterLink, NgTemplateOutlet, IconComponent, EmptyComponent, ToggleComponent, DtPipe, NumPipe, CountDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <div class="eyebrow">Mi turno</div>
          <h1 class="large-title">Hola, {{ auth.user()?.name?.split(' ')?.[0] }}</h1>
          <p>
            @if (me()?.vehicle; as v) {
              {{ v.plate }} · {{ types[v.type].label }} {{ v.brand }} {{ v.model }}
            } @else {
              No tienes vehículo asignado. Pídeselo a tu supervisor.
            }
          </p>
        </div>
      </header>

      @if (me(); as m) {
        @if (m.vehicle; as v) {
          <div class="mgrid">
            <section class="card mc">
              <div class="mc-head">
                <div class="mc-t">
                  <span>{{ m.driver.openTripId && m.driver.shiftActive ? 'Recorrido en curso' : 'Listo para empezar' }}</span>
                  <small>{{ m.driver.openTripId && m.driver.shiftActive ? 'Tu empresa te ve en el mapa.' : 'Inicia un recorrido cuando salgas.' }}</small>
                </div>
                <span class="badge" [class.solid]="m.driver.shiftActive">{{ m.driver.shiftActive ? 'En turno' : (driverStatus[m.driver.status] ?? 'Disponible') }}</span>
              </div>
              <div class="big"><b [wmsCount]="speed()"></b><small>km/h</small></div>
              <div class="kv"><span>Velocidad</span><b>{{ speed() | num: 0 }} km/h</b></div>
              <div class="kv"><span>GPS</span><b>{{ online() ? 'En línea' : 'Sin señal' }}</b></div>
              <div class="kv"><span>Último reporte</span><b>{{ lastTs() | dt: 'relative' }}</b></div>
              <div class="mbtns">
                @if (m.driver.openTripId && m.driver.shiftActive) {
                  <button class="btn primary lg" type="button" (click)="finish()" [disabled]="busy()">
                    <app-icon name="clock" [size]="16" />Finalizar recorrido
                  </button>
                } @else {
                  <button class="btn primary lg" type="button" (click)="start()" [disabled]="busy()">
                    <app-icon name="navigation" [size]="16" />Iniciar recorrido
                  </button>
                }
                <a class="btn lg" routerLink="/mapa" [queryParams]="{ v: v.id }"><app-icon name="map" [size]="16" />Mapa</a>
              </div>
            </section>

            <section class="card mc sos-card">
              <div class="mc-t"><span>Emergencia</span></div>
              <p class="note">Avisa de inmediato a tu empresa con tu ubicación.</p>
              <button class="btn primary lg sos" type="button" (click)="sos()" [disabled]="busy()" aria-label="Enviar alerta de emergencia">
                <app-icon name="siren" [size]="16" />Enviar alerta de emergencia
              </button>
            </section>

            <ng-container [ngTemplateOutlet]="locCard" />

            <section class="card mc full">
              <div class="mc-t"><span>Mis últimos recorridos</span></div>
              <div class="trips">
                @for (t of m.trips.slice(0, 5); track t.id) {
                  @if (t.status === 'open') {
                    <div class="trip">
                      <span class="tile solid"><app-icon name="navigation" [size]="14" /></span>
                      <span class="cell-txt"><b>En curso</b><small>Iniciado {{ t.startedAt | dt: 'shortTime' }}</small></span>
                      <b class="tkm">{{ t.distanceKm | num }} km</b>
                    </div>
                  } @else {
                    <div class="trip">
                      <span class="tile"><app-icon name="route" [size]="14" /></span>
                      <span class="cell-txt"><b>{{ t.startedAt | dt: 'shortTime' }}</b><small>{{ t.movingMinutes }} min · máx. {{ t.maxSpeed }} km/h</small></span>
                      <b class="tkm">{{ t.distanceKm | num }} km</b>
                    </div>
                  }
                } @empty {
                  <p class="note">Aún no tienes recorridos.</p>
                }
              </div>
            </section>
          </div>
        } @else {
          <div class="card">
            <app-empty icon="car" title="Sin vehículo asignado" text="Pídele a tu administrador que te asigne un vehículo en Conductores." />
          </div>
          <div class="mgrid" style="margin-top:18px"><ng-container [ngTemplateOutlet]="locCard" /></div>
        }
      } @else if (error()) {
        <div class="card">
          <app-empty icon="wifi-off" title="No pudimos cargar tu turno" [text]="error()" />
        </div>
      } @else {
        <div class="card"><div class="skeleton" style="height:180px"></div></div>
      }
    </div>

    <ng-template #locCard>
      <section class="card mc loc-card">
        <div class="mc-head">
          <div class="mc-t">
            <span>Ubicación de este celular</span>
            <small>Tu empresa te ve en el mapa mientras esté activa.</small>
          </div>
          <app-toggle [value]="loc.enabled.get()" (changed)="loc.setEnabled($event)" label="Compartir mi ubicación" />
        </div>
        <div class="kv"><span>Estado</span><b class="loc-state" [attr.data-state]="loc.status()"><span class="dot" [class.green]="loc.status() === 'active'" [class.pulse]="loc.status() === 'active'"></span>{{ shareLabels[loc.status()] }}</b></div>
        @if (loc.last(); as p) {
          <div class="kv"><span>Precisión</span><b>± {{ p.accuracy }} m</b></div>
          <div class="kv"><span>Última lectura</span><b>{{ p.ts | dt: 'relative' }}</b></div>
          <div class="kv"><span>Coordenadas</span><b class="mono">{{ p.lat.toFixed(5) }}, {{ p.lng.toFixed(5) }}</b></div>
        }
        @if (loc.status() === 'denied') {
          <p class="note">Permite el acceso a la ubicación para este sitio en los ajustes del navegador y vuelve a activarlo.</p>
        } @else if (loc.status() === 'insecure') {
          <p class="note">El navegador solo comparte la ubicación en sitios seguros (HTTPS).</p>
        } @else if (loc.error()) {
          <p class="note">{{ loc.error() }}</p>
        }
      </section>
    </ng-template>
  `,
  styles: `
    .mgrid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 18px; }
    .mgrid > * { animation: wms-in var(--dur-4) var(--ease) backwards; }
    .mgrid > :nth-child(1) { animation-delay: 120ms; } .mgrid > :nth-child(2) { animation-delay: 200ms; } .mgrid > :nth-child(3) { animation-delay: 280ms; }
    .mc { display: flex; flex-direction: column; gap: 12px; }
    .mc.full { grid-column: 1 / -1; }
    .loc-state { display: inline-flex; align-items: center; gap: 6px; }
    .mc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .mc-t { display: flex; flex-direction: column; gap: 2px; }
    .mc-t > span { font-size: 13px; font-weight: 600; }
    .mc-t small { font-size: 11px; color: var(--wms-muted); }
    .big { display: flex; align-items: baseline; gap: 6px; }
    .big b { font-size: 34px; line-height: 1; font-weight: 600; letter-spacing: -.035em; font-variant-numeric: tabular-nums; }
    .big small { font-size: 13px; color: var(--wms-muted); }
    .kv { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; padding: 8px 0; border-bottom: 1px solid var(--wms-divider); }
    .kv span { color: var(--wms-muted); }
    .kv b { font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
    .note { margin: 0; font-size: 12px; line-height: 1.5; color: var(--wms-muted); text-wrap: pretty; }
    .mbtns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: auto; padding-top: 4px; }
    .mbtns > * { flex: 1; height: 36px; border-radius: 10px; }
    .sos-card { background: var(--wms-card-hi); box-shadow: inset 0 0 0 1.5px var(--wms-text), var(--wms-card-shadow); }
    /* Prototipo: botón principal normal (monocromo), sin rojo */
    .sos { margin-top: auto; height: 44px; }
    .trips { display: flex; flex-direction: column; gap: 12px; }
    /* Filas del prototipo: 8px 10px, radio 12, fondo suave con borde */
    .trip { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 12px; background: var(--wms-soft); border: 1px solid var(--wms-divider); animation: wms-row-in var(--dur-4) var(--ease) backwards; }
    .trip .tile { width: 30px; height: 30px; border-radius: 9px; }
    .trip .cell-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .trip .cell-txt b { font-size: 13px; font-weight: 600; line-height: normal; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .trip .cell-txt small { font-size: 11px; line-height: normal; color: var(--wms-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tkm { flex: none; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .none { padding: 18px; border-radius: 12px; border: 1px dashed var(--wms-border); text-align: center; font-size: 12px; color: var(--wms-muted); }
    @media (max-width: 1000px) { .mgrid { grid-template-columns: minmax(0, 1fr); gap: 12px; } }
  `,
})
export class MyShiftPage implements OnInit, OnDestroy {
  private api = inject(Api);
  readonly auth = inject(Auth);
  readonly loc = inject(DriverLocation);
  readonly shareLabels = SHARE_LABELS;
  private live = inject(Live);
  private destroyRef = inject(DestroyRef);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  readonly me = signal<Me | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly speed = signal(0);
  readonly online = signal(false);
  readonly lastTs = signal<string | null>(null);
  readonly types = VEHICLE_TYPES;
  readonly driverStatus: Record<string, string> = { disponible: 'Disponible', en_ruta: 'En ruta', descanso: 'Descanso', inactivo: 'Inactivo' };
  private sub?: Subscription;

  async ngOnInit() {
    await this.load();
    // Si se salió de la vista mientras cargaba, no se abre la suscripción (quedaría viva).
    if (this.destroyRef.destroyed) return;
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
