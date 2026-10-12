import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { Api, errorMessage } from '../../core/api.service';
import { DtPipe, fmt, NumPipe } from '../../core/format';
import { Trip } from '../../core/models';
import { Theme } from '../../core/ui.services';
import { EmptyComponent } from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';
import { createMap, tileLayer, VehicleMarker } from './leaflet-kit';

interface Pt {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  ts: string;
}

/** Reproducción (playback) de un recorrido histórico sobre el mapa con línea de tiempo. */
@Component({
  selector: 'app-playback',
  imports: [FormsModule, IconComponent, EmptyComponent, DtPipe, NumPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pb">
      <aside class="trips">
        <div class="section-label" style="padding-left:4px">Recorridos de {{ plate() }}</div>
        @if (loading()) {
          <div class="skeleton" style="height:56px;margin-bottom:8px"></div>
          <div class="skeleton" style="height:56px"></div>
        }
        @for (t of trips(); track t.id) {
          <button type="button" class="trip" [class.active]="t.id === tripId()" (click)="open(t)">
            <div class="row">
              <strong class="tabular">{{ t.startedAt | dt: 'date' }}</strong
              ><span class="spacer"></span>
              @if (t.status === 'open') {
                <span class="badge green">En curso</span>
              }
            </div>
            <div class="caption tabular">
              {{ t.startedAt | dt: 'time' }} – {{ t.endedAt ? (t.endedAt | dt: 'time') : 'ahora' }}
            </div>
            <div class="caption tabular">
              {{ t.distanceKm | num }} km · máx {{ t.maxSpeed }} km/h · {{ t.alerts ?? 0 }} alertas
            </div>
          </button>
        } @empty {
          @if (!loading()) {
            <app-empty
              icon="route"
              title="Sin recorridos"
              text="Este vehículo aún no tiene recorridos registrados."
            />
          }
        }
      </aside>
      <div class="stage">
        <div class="pbmap" #map></div>
        @if (error()) {
          <div class="overlay-msg glass-thick">{{ error() }}</div>
        }
        @if (points().length) {
          <div class="timeline glass-thick">
            <button
              class="btn icon"
              type="button"
              (click)="toggle()"
              [attr.aria-label]="playing() ? 'Pausar' : 'Reproducir'"
            >
              <app-icon [name]="playing() ? 'pause' : 'play'" [size]="18" />
            </button>
            <div class="tl-main">
              <input
                type="range"
                min="0"
                [max]="points().length - 1"
                [ngModel]="idx()"
                (ngModelChange)="seek(+$event)"
                aria-label="Línea de tiempo del recorrido"
              />
              <div class="row caption tabular">
                <span>{{ current()?.ts | dt: 'time' }}</span
                ><span class="spacer"></span> <span>{{ current()?.speed ?? 0 | num: 0 }} km/h</span
                ><span class="spacer"></span>
                <span>{{ progress() }}</span>
              </div>
            </div>
            <select
              class="select"
              style="width:84px;height:34px"
              [ngModel]="speed()"
              (ngModelChange)="speed.set(+$event)"
              aria-label="Velocidad de reproducción"
            >
              @for (s of [1, 4, 8, 16, 32]; track s) {
                <option [value]="s">x{{ s }}</option>
              }
            </select>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .pb {
      display: grid;
      grid-template-columns: 260px 1fr;
      gap: 12px;
      height: min(70vh, 640px);
    }
    .trips {
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-right: 4px;
    }
    .trip {
      text-align: left;
      border: 0;
      border-radius: 14px;
      padding: 10px 12px;
      background: var(--bg-elevated);
      cursor: pointer;
      border: 0.5px solid var(--hairline);
      transition:
        background 160ms,
        box-shadow 160ms;
    }
    .trip:hover {
      background: var(--bg-hover);
    }
    .trip.active {
      box-shadow: inset 0 0 0 2px var(--tint);
    }
    .stage {
      position: relative;
      border-radius: 18px;
      overflow: hidden;
      min-height: 300px;
    }
    .pbmap {
      position: absolute;
      inset: 0;
    }
    .timeline {
      position: absolute;
      z-index: 500;
      left: 12px;
      right: 12px;
      bottom: 12px;
      display: flex;
      gap: 10px;
      align-items: center;
      padding: 10px 12px;
      border-radius: 18px;
    }
    .tl-main {
      flex: 1;
      min-width: 0;
    }
    .overlay-msg {
      position: absolute;
      z-index: 500;
      top: 12px;
      left: 12px;
      padding: 8px 12px;
      border-radius: 12px;
      font-size: 13px;
    }
    @media (max-width: 760px) {
      .pb {
        grid-template-columns: 1fr;
        grid-template-rows: 180px 1fr;
        height: 78vh;
      }
    }
  `,
})
export class PlaybackComponent implements OnDestroy {
  readonly vehicleId = input.required<string>();
  readonly plate = input('');
  private api = inject(Api);
  private theme = inject(Theme);
  private mapEl = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private map?: L.Map;
  private full?: L.Polyline;
  private done?: L.Polyline;
  private marker?: VehicleMarker;
  private timer?: ReturnType<typeof setInterval>;

  readonly trips = signal<Trip[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly tripId = signal<string | null>(null);
  readonly points = signal<Pt[]>([]);
  readonly idx = signal(0);
  readonly playing = signal(false);
  readonly speed = signal(8);
  readonly current = computed(() => this.points()[this.idx()]);
  readonly progress = computed(() => {
    const p = this.points();
    if (!p.length) return '';
    return fmt.duration((Date.parse(p[this.idx()].ts) - Date.parse(p[0].ts)) / 1000);
  });

  constructor() {
    effect(() => {
      const id = this.vehicleId();
      queueMicrotask(() => this.init(id));
    });
  }

  private async init(vehicleId: string) {
    if (!this.map) {
      this.map = createMap(this.mapEl().nativeElement, { zoom: 13 });
      tileLayer(this.theme.isDark() ? 'dark' : 'osm').addTo(this.map);
      L.control.zoom({ position: 'topright' }).addTo(this.map);
      setTimeout(() => this.map?.invalidateSize(), 350);
    }
    this.loading.set(true);
    try {
      const trips = await this.api.get<Trip[]>(`vehicles/${vehicleId}/trips`);
      this.trips.set(trips);
      if (trips[0]) await this.open(trips[0]);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async open(t: Trip) {
    this.pause();
    this.tripId.set(t.id);
    const r = await this.api.get<{ positions: Pt[] }>(`trips/${t.id}/positions`);
    this.points.set(r.positions);
    this.idx.set(0);
    this.full?.remove();
    this.done?.remove();
    this.marker?.remove();
    if (!r.positions.length || !this.map) return;
    const ll = r.positions.map((p) => [p.lat, p.lng] as [number, number]);
    this.full = L.polyline(ll, {
      color: '#8E8E93',
      weight: 5,
      opacity: 0.5,
      lineCap: 'round',
    }).addTo(this.map);
    this.done = L.polyline([ll[0]], {
      color: '#007AFF',
      weight: 5,
      opacity: 0.9,
      lineCap: 'round',
    }).addTo(this.map);
    this.marker = new VehicleMarker(
      this.map,
      t.vehicleId,
      this.plate(),
      t.vehicleType ?? 'carro',
      ll[0],
      r.positions[0].heading,
      99999,
    );
    this.marker.trail.remove();
    this.map.fitBounds(this.full.getBounds().pad(0.15));
    setTimeout(() => this.map?.invalidateSize(), 50);
  }

  seek(i: number) {
    const p = this.points();
    if (!p.length) return;
    this.idx.set(Math.max(0, Math.min(p.length - 1, i)));
    const cur = p[this.idx()];
    this.marker?.moveTo([cur.lat, cur.lng], cur.heading, 200);
    this.done?.setLatLngs(
      p.slice(0, this.idx() + 1).map((x) => [x.lat, x.lng] as [number, number]),
    );
  }

  toggle() {
    if (this.playing()) return this.pause();
    if (this.idx() >= this.points().length - 1) this.seek(0);
    this.playing.set(true);
    // Avance fraccional: x1 ≈ 1 punto/s, x32 ≈ 8 puntos por cuadro.
    let acc = 0;
    this.timer = setInterval(() => {
      acc += this.speed() / 4;
      const step = Math.floor(acc);
      if (!step) return;
      acc -= step;
      const next = this.idx() + step;
      if (next >= this.points().length) {
        this.seek(this.points().length - 1);
        this.pause();
      } else this.seek(next);
    }, 230);
  }

  pause() {
    this.playing.set(false);
    clearInterval(this.timer);
  }

  ngOnDestroy() {
    this.pause();
    this.marker?.remove();
    this.map?.remove();
  }
}
