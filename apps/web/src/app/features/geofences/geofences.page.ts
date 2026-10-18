import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { Api, errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { fmt, VEHICLE_TYPES } from '../../core/format';
import { Geofence, LatLng, Vehicle } from '../../core/models';
import { Confirm, Theme, Toasts } from '../../core/ui.services';
import { EmptyComponent, SegmentedComponent, ToggleComponent } from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';
import { DebounceInputDirective } from '../../ui/motion-directives';
import { createMap, geofenceLayer, tileLayer } from '../map/leaflet-kit';

type Shape = 'circle' | 'polygon' | 'corridor';
interface Draft {
  id: string | null;
  name: string;
  description: string;
  shape: Shape;
  center: LatLng | null;
  radiusM: number;
  coordinates: LatLng[];
  color: string;
  vehicleIds: string[];
  active: boolean;
}

const COLORS = [
  '#007AFF',
  '#34C759',
  '#FF9500',
  '#FF3B30',
  '#AF52DE',
  '#5856D6',
  '#30B0C7',
  '#FF2D55',
];
const SHAPE_META: Record<Shape, { label: string; icon: string }> = {
  circle: { label: 'Círculo', icon: 'circle' },
  polygon: { label: 'Polígono', icon: 'pentagon' },
  corridor: { label: 'Corredor de ruta', icon: 'spline' },
};

/** RE2 / RF5-RF8 – Geocercas dibujables sobre el mapa (círculo, polígono o corredor de ruta). */
@Component({
  selector: 'app-geofences',
  imports: [DebounceInputDirective, FormsModule, IconComponent, SegmentedComponent, ToggleComponent, EmptyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './geofences.page.html',
  styleUrl: './geofences.page.scss',
  host: { '[class.map-mode]': 'mapMode()' },
})
export class GeofencesPage implements AfterViewInit, OnDestroy {
  /** Solo presentación (rediseño): geocercas activas. */
  activeCount() {
    return this.geofences().filter((g) => g.active).length;
  }
  /**
   * Vista del prototipo: lista de geocercas. El mapa (dibujo, edición, "dentro ahora") se muestra al pulsar
   * «Ver en el mapa», al crear/editar o al elegir una geocerca; no se quita ninguna función.
   */
  readonly mapMode = signal(false);
  readonly q = signal('');
  readonly shownList = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.geofences().filter((g) => !q || (g.name + ' ' + (g.description ?? '')).toLowerCase().includes(q));
  });
  /** Reglas por geocerca (prototipo: "2 reglas"); solo lectura, si el rol puede ver alertas. */
  readonly rulesBy = signal<Record<string, number>>({});
  showMap(g?: Geofence) {
    this.mapMode.set(true);
    setTimeout(() => {
      this.map.invalidateSize();
      if (g) this.focus(g);
    });
  }
  backToList() {
    if (this.draft()) return;
    this.mapMode.set(false);
  }
  geoText(g: Geofence) {
    const geo =
      g.shape === 'circle'
        ? `Radio ${g.radiusM} m`
        : g.shape === 'corridor'
          ? `Ancho ${g.radiusM} m`
          : `${g.coordinates.length} vértices`;
    const veh = g.allVehicles || !g.vehicleIds.length ? 'Todos los vehículos' : g.vehicleIds.map(this.plateOf).join(', ');
    const n = this.rulesBy()[g.id] ?? 0;
    return `${geo} · ${veh} · ${n} ${n === 1 ? 'regla' : 'reglas'}`;
  }

  private api = inject(Api);
  readonly auth = inject(Auth);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);
  private theme = inject(Theme);
  private mapEl = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private map!: L.Map;
  private layers = L.layerGroup();
  private draftLayer = L.layerGroup();
  private ro?: ResizeObserver;

  readonly geofences = signal<Geofence[]>([]);
  readonly vehicles = signal<Vehicle[]>([]);
  readonly loading = signal(true);
  readonly draft = signal<Draft | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly colors = COLORS;
  readonly shapes = SHAPE_META;
  readonly types = VEHICLE_TYPES;
  readonly shapeOptions = (Object.keys(SHAPE_META) as Shape[]).map((value) => ({
    value,
    label: SHAPE_META[value].label,
  }));
  readonly canWrite = computed(() => this.auth.can('geofences', 'write'));
  readonly plateOf = (id: string) => this.vehicles().find((v) => v.id === id)?.plate ?? '—';

  readonly hint = computed(() => {
    const d = this.draft();
    if (!d) return '';
    if (d.shape === 'circle')
      return d.center
        ? 'Toca el mapa para mover el centro o arrástralo. Ajusta el radio abajo.'
        : 'Toca el mapa para ubicar el centro del círculo.';
    if (d.shape === 'polygon')
      return d.coordinates.length < 3
        ? `Toca el mapa para agregar vértices (${d.coordinates.length}/3 mínimo).`
        : 'Arrastra los vértices para ajustar. Toca para agregar más.';
    return d.coordinates.length < 2
      ? 'Toca el mapa siguiendo la ruta autorizada (mínimo 2 puntos).'
      : 'Sigue agregando puntos sobre la ruta. Ajusta el ancho del corredor.';
  });
  readonly area = computed(() => {
    const d = this.draft();
    if (!d) return '';
    if (d.shape === 'circle') return `${fmt.num((Math.PI * d.radiusM ** 2) / 1e6, 2)} km²`;
    if (d.shape === 'corridor' && d.coordinates.length > 1) {
      let m = 0;
      for (let i = 1; i < d.coordinates.length; i++)
        m += L.latLng(d.coordinates[i - 1]).distanceTo(L.latLng(d.coordinates[i]));
      return `${fmt.num(m / 1000, 2)} km de ruta`;
    }
    return `${d.coordinates.length} vértices`;
  });

  constructor() {
    effect(() => {
      this.renderDraft(this.draft());
    });
    effect(() => {
      const dark = this.theme.isDark();
      if (this.map) this.setBase(dark);
    });
  }

  private base?: L.TileLayer;
  private setBase(dark: boolean) {
    this.base?.remove();
    this.base = tileLayer(dark ? 'dark' : 'osm').addTo(this.map);
    this.base.bringToBack();
  }

  async ngAfterViewInit() {
    this.map = createMap(this.mapEl().nativeElement, { zoom: 13 });
    this.setBase(this.theme.isDark());
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    this.layers.addTo(this.map);
    this.draftLayer.addTo(this.map);
    this.map.on('click', (e: L.LeafletMouseEvent) => this.onMapClick([e.latlng.lat, e.latlng.lng]));
    this.map.on(
      'zoomend',
      () => this.draft()?.shape === 'corridor' && this.renderDraft(this.draft()),
    );
    this.ro = new ResizeObserver(() => this.map.invalidateSize());
    this.ro.observe(this.mapEl().nativeElement);
    await this.load();
  }

  ngOnDestroy() {
    this.ro?.disconnect();
    this.map?.remove();
  }

  async load() {
    this.loading.set(true);
    try {
      const [g, v] = await Promise.all([
        this.api.get<Geofence[]>('geofences'),
        this.auth.can('vehicles') ? this.api.get<Vehicle[]>('vehicles') : Promise.resolve([]),
      ]);
      this.geofences.set(g);
      this.vehicles.set(v);
      if (this.auth.can('alerts'))
        this.api.get<{ geofenceId: string | null }[]>('alert-rules').then((rules) => {
          const m: Record<string, number> = {};
          for (const r of rules) if (r.geofenceId) m[r.geofenceId] = (m[r.geofenceId] ?? 0) + 1;
          this.rulesBy.set(m);
        }, () => {});
      this.renderAll();
    } catch (e) {
      this.toasts.error('No se pudieron cargar las geocercas', errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private renderAll() {
    this.layers.clearLayers();
    const editingId = this.draft()?.id;
    for (const g of this.geofences()) {
      if (g.id === editingId) continue;
      const layer = geofenceLayer(g, { label: true, dim: !!this.draft() || !g.active });
      layer.on('click', (e: L.LeafletMouseEvent) => {
        if (this.draft()) return;
        L.DomEvent.stopPropagation(e);
        this.focus(g);
      });
      this.layers.addLayer(layer);
    }
  }

  focus(g: Geofence) {
    const layer = geofenceLayer(g);
    const b =
      (layer as L.Polygon).getBounds?.() ??
      (g.center ? L.latLng(g.center).toBounds((g.radiusM ?? 100) * 2) : null);
    if (b)
      this.map.flyToBounds(b.pad(0.3), {
        duration: 0.7,
        paddingTopLeft: [window.innerWidth > 760 ? 380 : 0, 0],
      });
  }

  startCreate() {
    this.error.set('');
    this.draft.set({
      id: null,
      name: '',
      description: '',
      shape: 'circle',
      center: null,
      radiusM: 250,
      coordinates: [],
      color: '#007AFF',
      vehicleIds: [],
      active: true,
    });
    this.renderAll();
  }

  startEdit(g: Geofence) {
    this.error.set('');
    this.draft.set({
      id: g.id,
      name: g.name,
      description: g.description,
      shape: g.shape,
      center: g.center,
      radiusM: g.radiusM ?? 250,
      coordinates: [...g.coordinates],
      color: g.color,
      vehicleIds: g.allVehicles ? [] : [...g.vehicleIds],
      active: g.active,
    });
    this.renderAll();
    this.focus(g);
  }

  cancel() {
    this.draft.set(null);
    this.renderAll();
  }

  update(p: Partial<Draft>) {
    const d = this.draft();
    if (d) this.draft.set({ ...d, ...p });
  }

  setShape(shape: Shape) {
    const d = this.draft();
    if (!d || d.shape === shape) return;
    this.update({
      shape,
      coordinates: [],
      center: d.shape === 'circle' ? null : d.center,
      radiusM: shape === 'corridor' ? 120 : 250,
    });
  }

  undo() {
    const d = this.draft();
    if (d) this.update({ coordinates: d.coordinates.slice(0, -1) });
  }

  clearShape() {
    this.update({ coordinates: [], center: null });
  }

  toggleVehicle(id: string, on: boolean) {
    const d = this.draft();
    if (!d) return;
    this.update({ vehicleIds: on ? [...d.vehicleIds, id] : d.vehicleIds.filter((x) => x !== id) });
  }

  private onMapClick(p: LatLng) {
    const d = this.draft();
    if (!d) return;
    if (d.shape === 'circle') this.update({ center: p });
    else this.update({ coordinates: [...d.coordinates, p] });
  }

  private renderDraft(d: Draft | null) {
    if (!this.map) return;
    this.draftLayer.clearLayers();
    if (!d) return;
    const style = { color: d.color, weight: 2.5, fillColor: d.color, fillOpacity: 0.16 };
    const vertex = (p: LatLng, onMove: (p: LatLng) => void) => {
      const m = L.marker(p, {
        draggable: true,
        icon: L.divIcon({ className: 'draw-vertex', iconSize: [14, 14] }),
        keyboard: false,
      });
      m.on('dragend', () => {
        const ll = m.getLatLng();
        onMove([ll.lat, ll.lng]);
      });
      this.draftLayer.addLayer(m);
    };
    if (d.shape === 'circle' && d.center) {
      this.draftLayer.addLayer(L.circle(d.center, { ...style, radius: d.radiusM }));
      vertex(d.center, (p) => this.update({ center: p }));
    } else if (d.shape === 'polygon' && d.coordinates.length) {
      this.draftLayer.addLayer(
        d.coordinates.length >= 3
          ? L.polygon(d.coordinates, style)
          : L.polyline(d.coordinates, { ...style, dashArray: '6 6' }),
      );
      d.coordinates.forEach((c, i) =>
        vertex(c, (p) =>
          this.update({ coordinates: d.coordinates.map((x, j) => (j === i ? p : x)) }),
        ),
      );
    } else if (d.shape === 'corridor' && d.coordinates.length) {
      // Ancho visual aproximado del corredor (en píxeles según zoom) + línea central
      const mpp =
        (40075016.686 * Math.cos((d.coordinates[0][0] * Math.PI) / 180)) /
        Math.pow(2, this.map.getZoom() + 8);
      this.draftLayer.addLayer(
        L.polyline(d.coordinates, {
          color: d.color,
          opacity: 0.25,
          weight: Math.max(6, (d.radiusM * 2) / mpp),
          lineCap: 'round',
          lineJoin: 'round',
        }),
      );
      this.draftLayer.addLayer(L.polyline(d.coordinates, { color: d.color, weight: 2.5 }));
      if (d.coordinates.length <= 60)
        d.coordinates.forEach((c, i) =>
          vertex(c, (p) =>
            this.update({ coordinates: d.coordinates.map((x, j) => (j === i ? p : x)) }),
          ),
        );
    }
  }

  async save() {
    const d = this.draft();
    if (!d) return;
    this.busy.set(true);
    this.error.set('');
    const body = {
      name: d.name,
      description: d.description,
      shape: d.shape,
      center: d.shape === 'circle' ? d.center : null,
      radiusM: d.shape === 'polygon' ? null : d.radiusM,
      coordinates: d.shape === 'circle' ? [] : d.coordinates,
      color: d.color,
      vehicleIds: d.vehicleIds,
      active: d.active,
    };
    try {
      if (d.id) await this.api.patch(`geofences/${d.id}`, body);
      else await this.api.post('geofences', body);
      this.toasts.success(
        d.id ? 'Geocerca actualizada' : 'Geocerca creada',
        'Las alertas de entrada/salida se evaluarán con la siguiente posición de cada vehículo.',
      );
      this.draft.set(null);
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async toggleActive(g: Geofence, active: boolean) {
    try {
      await this.api.patch(`geofences/${g.id}`, { active });
      await this.load();
    } catch (e) {
      this.toasts.error('No se pudo actualizar', errorMessage(e));
    }
  }

  /** RF8 – Eliminación lógica. */
  async remove(g: Geofence) {
    const ok = await this.confirm.ask({
      title: `¿Eliminar «${g.name}»?`,
      message: 'La geocerca dejará de generar alertas. Las alertas históricas se conservan.',
      confirmText: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(`geofences/${g.id}`);
      this.toasts.success('Geocerca eliminada');
      if (this.draft()?.id === g.id) this.draft.set(null);
      await this.load();
    } catch (e) {
      this.toasts.error('No se pudo eliminar', errorMessage(e));
    }
  }
}
