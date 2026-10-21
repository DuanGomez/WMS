import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  DestroyRef,
  ElementRef,
  inject,
  input,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { Auth } from '../../core/auth.service';
import { fmt, VEHICLE_TYPES } from '../../core/format';
import { Live } from '../../core/live.service';
import { DriverMarker, Geofence, LivePosition, Vehicle } from '../../core/models';
import { pref, Theme } from '../../core/ui.services';
import { IconComponent, iconSvg } from '../../ui/icon.component';
import { SegmentedComponent, ToggleComponent } from '../../ui/components';
import { SheetDragDirective } from '../../ui/motion-directives';
import {
  BASE_LAYERS,
  BaseLayer,
  createMap,
  geofenceLayer,
  tileLayer,
  VehicleMarker,
} from './leaflet-kit';

interface VM {
  id: string;
  plate: string;
  type: string;
  brand: string;
  model: string;
  driverName: string | null;
  driverPhone: string | null;
  deviceSerial: string | null;
  lat: number | null;
  lng: number | null;
  speed: number;
  heading: number;
  battery: number | null;
  ignition: boolean;
  accuracy: number;
  ts: string | null;
  stoppedSince: string | null;
  connection: string;
  alarmUntil: number;
}

type Filter = 'all' | 'moving' | 'stopped' | 'offline';
type LayerPref = BaseLayer | 'auto';

/** HU1 / RE1 / RG2 – Mapa en vivo con actualización en tiempo real e interpolación de posiciones. */
@Component({
  selector: 'app-live-map',
  imports: [
    FormsModule,
    RouterLink,
    DecimalPipe,
    IconComponent,
    SegmentedComponent,
    ToggleComponent,
    SheetDragDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './live-map.page.html',
  styleUrl: './live-map.page.scss',
  host: { '[class.has-detail]': '!!selected()' },
})
export class LiveMapPage implements AfterViewInit, OnDestroy {
  readonly live = inject(Live);
  private destroyRef = inject(DestroyRef);
  readonly auth = inject(Auth);
  private theme = inject(Theme);
  private router = inject(Router);
  /** ?v=<vehicleId> preselecciona un vehículo (desde una notificación). */
  readonly v = input<string>();
  /** ?d=<driverId> centra el mapa en el celular de un conductor. */
  readonly d = input<string>();

  private mapEl = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private map!: L.Map;
  private base?: L.TileLayer;
  private gfGroup = L.layerGroup();
  private markers = new Map<string, VehicleMarker>();
  private driverGroup = L.layerGroup();
  private driverMarkers = new Map<string, { marker: L.Marker; ring: L.Circle }>();
  private subs: Subscription[] = [];
  private ro?: ResizeObserver;
  private clock?: ReturnType<typeof setInterval>;

  readonly vehicles = signal<Record<string, VM>>({});
  /** Conductores que comparten la ubicación de su celular. */
  readonly drivers = signal<Record<string, DriverMarker>>({});
  readonly driverList = computed(() =>
    Object.values(this.drivers()).sort((a, b) => Number(this.driverLive(b)) - Number(this.driverLive(a)) || a.name.localeCompare(b.name)),
  );
  readonly geofences = signal<Geofence[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly follow = signal(true);
  readonly filter = signal<Filter>('all');
  readonly query = signal('');
  readonly loading = signal(true);
  readonly layersOpen = signal(false);
  readonly now = signal(Date.now());
  readonly layerPref = pref<LayerPref>('mapLayer', 'osm');
  readonly showGeofences = pref('mapGeofences', true);
  readonly sheetH = signal(0);
  /** Altura de la ficha del vehículo en móvil (hoja arrastrable); minimizada deja ver placa y estado. */
  readonly detailH = signal(0);
  readonly detailPeek = 176;

  readonly filterOptions = [
    { value: 'all', label: 'Todos' },
    { value: 'moving', label: 'En marcha' },
    { value: 'stopped', label: 'Detenidos' },
    { value: 'offline', label: 'Sin señal' },
  ];
  readonly layerOptions: { value: LayerPref; label: string }[] = [
    { value: 'osm', label: BASE_LAYERS.osm.label },
    { value: 'auto', label: 'Automático (según tema)' },
    { value: 'light', label: BASE_LAYERS.light.label },
    { value: 'dark', label: BASE_LAYERS.dark.label },
  ];
  readonly typeIcon = (t: string) => VEHICLE_TYPES[t]?.icon ?? 'car';
  readonly typeLabel = (t: string) => VEHICLE_TYPES[t]?.label ?? t;

  readonly list = computed(() => {
    const q = this.query().trim().toLowerCase();
    const f = this.filter();
    return Object.values(this.vehicles())
      .filter(
        (v) =>
          !q || v.plate.toLowerCase().includes(q) || (v.driverName ?? '').toLowerCase().includes(q),
      )
      .filter(
        (v) =>
          f === 'all' || this.status(v) === f || (f === 'stopped' && this.status(v) === 'parked'),
      )
      .sort((a, b) => a.plate.localeCompare(b.plate));
  });
  readonly counts = computed(() => {
    const all = Object.values(this.vehicles());
    return {
      total: all.length,
      moving: all.filter((v) => this.status(v) === 'moving').length,
      offline: all.filter((v) => this.status(v) === 'offline').length,
    };
  });
  readonly selected = computed(() =>
    this.selectedId() ? (this.vehicles()[this.selectedId()!] ?? null) : null,
  );

  constructor() {
    // Capa base automática según tema
    effect(() => {
      const p = this.layerPref.get();
      const dark = this.theme.isDark();
      if (this.map) this.setBase(p === 'auto' ? (dark ? 'dark' : 'light') : p);
    });
    effect(() => {
      const show = this.showGeofences.get();
      if (!this.map) return;
      if (show) this.gfGroup.addTo(this.map);
      else this.gfGroup.remove();
    });
    // Estado visual de los marcadores
    effect(() => {
      const vs = this.vehicles();
      const sel = this.selectedId();
      const t = this.now();
      for (const v of Object.values(vs)) {
        const st = this.status(v);
        this.markers
          .get(v.id)
          ?.setState({
            selected: v.id === sel,
            stopped: st === 'stopped' || st === 'parked',
            offline: st === 'offline',
            alarm: v.alarmUntil > t,
          });
      }
    });
  }

  async ngAfterViewInit() {
    this.map = createMap(this.mapEl().nativeElement);
    const p = this.layerPref.get();
    this.setBase(p === 'auto' ? (this.theme.isDark() ? 'dark' : 'light') : p);
    if (this.showGeofences.get()) this.gfGroup.addTo(this.map);
    this.driverGroup.addTo(this.map);
    this.map.on('dragstart', () => this.follow.set(false));
    this.ro = new ResizeObserver(() => this.map.invalidateSize({ pan: false }));
    this.ro.observe(this.mapEl().nativeElement);
    this.clock = setInterval(() => this.now.set(Date.now()), 1000);
    this.sheetH.set(Math.round(window.innerHeight * 0.38));
    this.detailH.set(Math.round(window.innerHeight * 0.45));

    try {
      const snap = await this.live.snapshot();
      // Si se salió de la vista mientras cargaba, el mapa ya se destruyó: no se pintan marcadores ni se abren suscripciones.
      if (this.destroyRef.destroyed) return;
      this.geofences.set(snap.geofences);
      for (const g of snap.geofences) this.gfGroup.addLayer(geofenceLayer(g, { label: true }));
      const record: Record<string, VM> = {};
      for (const v of snap.vehicles) {
        record[v.id] = this.toVM(v);
        if (v.live) this.addMarker(record[v.id], v.trail ?? [], snap.trailMinutes);
      }
      this.vehicles.set(record);
      for (const dm of snap.drivers ?? []) this.upsertDriver(dm);
      const pre = this.v();
      const preDriver = this.d();
      if (pre && record[pre]) this.select(pre);
      else if (preDriver && this.drivers()[preDriver]) this.focusDriver(preDriver);
      else this.fitAll(false);
    } finally {
      this.loading.set(false);
    }

    this.subs.push(
      this.live.positions$.subscribe((p) => this.onPosition(p)),
      this.live.drivers$.subscribe((dm) => this.upsertDriver(dm)),
      this.live.devices$.subscribe((d) => {
        if (!d.vehicleId) return;
        this.patch(d.vehicleId, { connection: d.connection });
      }),
      this.live.alerts$.subscribe((a) => {
        if (a.vehicleId && ['critical', 'high'].includes(a.priority) && !a.attended)
          this.patch(a.vehicleId, { alarmUntil: Date.now() + 60_000 });
      }),
    );
  }

  ngOnDestroy() {
    this.subs.forEach((s) => s.unsubscribe());
    this.ro?.disconnect();
    clearInterval(this.clock);
    this.markers.forEach((m) => m.remove());
    this.map?.remove();
  }

  /* ---------- Conductores (ubicación del celular) ---------- */

  /** Activo si comparte y reportó en los últimos 10 minutos. */
  driverLive(d: DriverMarker) {
    return d.sharing && this.now() - Date.parse(d.ts) < 10 * 60_000;
  }

  private upsertDriver(d: DriverMarker) {
    this.drivers.update((all) => ({ ...all, [d.driverId]: d }));
    const live = this.driverLive(d);
    const first = d.name.split(' ')[0];
    const html = `<div class="drv${live ? '' : ' off'}"><div class="drv-dot">${iconSvg('user', 13, 2.4)}</div><div class="drv-label">${escapeHtml(first)}</div></div>`;
    const icon = L.divIcon({ className: '', iconSize: [0, 0], html });
    const popup = `<strong>${escapeHtml(d.name)}</strong><br>${d.vehiclePlate ? 'Vehículo ' + escapeHtml(d.vehiclePlate) + ' · ' : ''}Celular del conductor<br>Precisión ± ${d.accuracy ?? '—'} m · ${live ? 'en vivo' : 'sin actualizar'}`;
    const existing = this.driverMarkers.get(d.driverId);
    if (existing) {
      existing.marker.setLatLng([d.lat, d.lng]).setIcon(icon).setPopupContent(popup);
      existing.ring.setLatLng([d.lat, d.lng]).setRadius(Math.min(d.accuracy ?? 0, 300));
      return;
    }
    const ring = L.circle([d.lat, d.lng], {
      radius: Math.min(d.accuracy ?? 0, 300),
      color: '#34C759',
      weight: 1,
      opacity: 0.5,
      fillOpacity: 0.08,
      interactive: false,
    });
    const marker = L.marker([d.lat, d.lng], { icon, title: d.name, zIndexOffset: 800, keyboard: true }).bindPopup(popup);
    this.driverGroup.addLayer(ring).addLayer(marker);
    this.driverMarkers.set(d.driverId, { marker, ring });
  }

  focusDriver(id: string) {
    const d = this.drivers()[id];
    const m = this.driverMarkers.get(id);
    if (!d || !m) return;
    this.selectedId.set(null);
    this.follow.set(false);
    const z = Math.max(this.map.getZoom(), 16);
    this.map.flyTo(this.visibleCenter([d.lat, d.lng], z), z, { duration: 0.8 });
    setTimeout(() => m.marker.openPopup(), 850);
  }

  private toVM(v: Vehicle): VM {
    return {
      id: v.id,
      plate: v.plate,
      type: v.type,
      brand: v.brand,
      model: v.model,
      driverName: v.driver?.name ?? null,
      driverPhone: v.driver?.phone ?? null,
      deviceSerial: v.device?.serial ?? null,
      lat: v.live?.lat ?? null,
      lng: v.live?.lng ?? null,
      speed: v.live?.speed ?? 0,
      heading: v.live?.heading ?? 0,
      battery: v.live?.battery ?? v.device?.battery ?? null,
      ignition: v.live?.ignition ?? false,
      accuracy: v.live?.accuracy ?? 0,
      ts: v.live?.ts ?? null,
      stoppedSince: v.live?.stoppedSince ?? null,
      connection: v.device ? v.device.connection : 'unknown',
      alarmUntil: 0,
    };
  }

  private addMarker(v: VM, trail: [number, number][], minutes: number) {
    if (v.lat == null || v.lng == null) return;
    const m = new VehicleMarker(
      this.map,
      v.id,
      v.plate,
      v.type,
      [v.lat, v.lng],
      v.heading,
      minutes,
      () => this.select(v.id),
    );
    m.setTrail(trail);
    this.markers.set(v.id, m);
  }

  private patch(id: string, p: Partial<VM>) {
    this.vehicles.update((all) => (all[id] ? { ...all, [id]: { ...all[id], ...p } } : all));
  }

  private onPosition(p: LivePosition) {
    const prev = this.vehicles()[p.vehicleId];
    if (!prev) return;
    const interval = prev.ts ? Date.parse(p.ts) - Date.parse(prev.ts) : 1000;
    this.patch(p.vehicleId, {
      lat: p.lat,
      lng: p.lng,
      speed: p.speed,
      heading: p.heading,
      battery: p.battery,
      ignition: p.ignition,
      accuracy: p.accuracy,
      ts: p.ts,
      stoppedSince: p.stoppedSince,
      connection: 'online',
      driverName: p.driverName,
    });
    let m = this.markers.get(p.vehicleId);
    if (!m) {
      this.addMarker({ ...prev, lat: p.lat, lng: p.lng }, [], 10);
      m = this.markers.get(p.vehicleId);
    }
    m?.moveTo([p.lat, p.lng], p.heading, interval);
    if (this.follow() && this.selectedId() === p.vehicleId)
      this.map.panTo(this.visibleCenter([p.lat, p.lng], this.map.getZoom()), {
        animate: true,
        duration: Math.min(1.2, interval / 1000),
        easeLinearity: 1,
      });
  }

  status(v: VM): 'moving' | 'stopped' | 'parked' | 'offline' {
    if (v.connection === 'offline' || v.connection === 'unknown' || !v.ts) return 'offline';
    if (!v.ignition && v.speed < 2) return 'parked';
    return v.speed >= 2 ? 'moving' : 'stopped';
  }
  statusLabel(v: VM) {
    const s = this.status(v);
    if (s === 'moving') return `${Math.round(v.speed)} km/h`;
    if (s === 'offline') return 'Sin señal';
    if (v.stoppedSince)
      return `Detenido ${fmt.duration((this.now() - Date.parse(v.stoppedSince)) / 1000)}`;
    return 'Detenido';
  }
  statusTone(v: VM) {
    if (v.alarmUntil > this.now()) return 'red';
    return { moving: 'blue', stopped: 'orange', parked: 'orange', offline: 'gray' }[this.status(v)];
  }
  ago(ts: string | null) {
    this.now();
    return fmt.relative(ts);
  }

  select(id: string | null) {
    this.selectedId.set(id);
    if (!id) return;
    const v = this.vehicles()[id];
    this.follow.set(true);
    if (v?.lat != null) {
      const z = Math.max(this.map.getZoom(), 15);
      this.map.flyTo(this.visibleCenter([v.lat, v.lng!], z), z, { duration: 0.8 });
    }
    if (this.sheetH() < 260) this.sheetH.set(Math.round(window.innerHeight * 0.42));
  }

  /** Al cambiar la altura de la ficha, el vehículo seguido vuelve al centro de la zona que queda a la vista. */
  recenter() {
    const v = this.selected();
    if (this.follow() && v?.lat != null)
      this.map.panTo(this.visibleCenter([v.lat, v.lng!], this.map.getZoom()), { duration: 0.4 });
  }

  /** Lo que tapan los paneles sobre el mapa (px): en móvil la hoja de abajo; si no, la lista (izquierda) y la
   *  ficha del vehículo (derecha). Hasta 1100 px la lista se oculta al abrir la ficha (clase has-detail). */
  private covered() {
    const w = window.innerWidth;
    const sel = !!this.selectedId();
    if (w <= 760) return { left: 0, right: 0, bottom: sel ? this.detailH() + 8 : this.sheetH() };
    return {
      left: sel && w <= 1100 ? 0 : 370,
      right: sel ? Math.min(440, this.mapEl().nativeElement.clientWidth - 24) + 12 : 0,
      bottom: 0,
    };
  }

  /** Centro del mapa que deja `ll` en el medio de la zona que queda a la vista entre los paneles. */
  private visibleCenter(ll: L.LatLngExpression, zoom: number): L.LatLng {
    const c = this.covered();
    if (!c.left && !c.right && !c.bottom) return L.latLng(ll);
    return this.map.unproject(this.map.project(ll, zoom).add([(c.right - c.left) / 2, c.bottom / 2]), zoom);
  }

  fitAll(animate = true) {
    const pts = Object.values(this.vehicles())
      .filter((v) => v.lat != null)
      .map((v) => [v.lat!, v.lng!] as [number, number]);
    if (!pts.length) return;
    this.follow.set(false);
    if (pts.length === 1) this.map.setView(this.visibleCenter(pts[0], 15), 15, { animate });
    else {
      const c = this.covered();
      this.map.fitBounds(L.latLngBounds(pts).pad(0.25), {
        animate,
        maxZoom: 15,
        paddingTopLeft: [c.left ? c.left + 50 : 0, 0],
        paddingBottomRight: [c.right, c.bottom],
      });
    }
  }

  zoom(d: number) {
    this.map.setZoom(this.map.getZoom() + d);
  }

  setBase(kind: BaseLayer) {
    this.base?.remove();
    this.base = tileLayer(kind).addTo(this.map);
    this.base.bringToBack();
  }

  setLayer(p: LayerPref) {
    this.layerPref.set(p);
    this.layersOpen.set(false);
  }

  openTrips(id: string) {
    this.router.navigate(['/vehiculos'], { queryParams: { id, tab: 'recorridos' } });
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
