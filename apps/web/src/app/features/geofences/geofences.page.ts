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
import { DebounceInputDirective, SheetDragDirective } from '../../ui/motion-directives';
import { createMap, geofenceLayer, tileLayer } from '../map/leaflet-kit';

/** 'freehand' es solo de la interfaz: el trazo se guarda como polígono. */
type Shape = 'freehand' | 'circle' | 'polygon' | 'corridor';
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
  freehand: { label: 'Dibujo libre', icon: 'pencil' },
  circle: { label: 'Círculo', icon: 'circle' },
  polygon: { label: 'Por puntos', icon: 'pentagon' },
  corridor: { label: 'Corredor', icon: 'spline' },
};

/** RE2 / RF5-RF8 – Geocercas dibujables sobre el mapa (círculo, polígono o corredor de ruta). */
@Component({
  selector: 'app-geofences',
  imports: [DebounceInputDirective, SheetDragDirective, FormsModule, IconComponent, SegmentedComponent, ToggleComponent, EmptyComponent],
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
  /** Altura del panel en móvil (hoja arrastrable sobre el mapa). */
  readonly panelH = signal(Math.round(window.innerHeight * 0.46));
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
  /** Solo en la primera carga: al recargar (guardar, filtrar) la lista sigue visible, sin pasar por el esqueleto. */
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
    if (d.shape === 'freehand')
      return 'Mantén presionado y dibuja el perímetro sobre el mapa. Al soltar, la geocerca se cierra sola.';
    if (d.shape === 'circle')
      return d.center
        ? 'Toca el mapa para mover el centro o arrástralo. Ajusta el radio abajo.'
        : 'Toca el mapa para ubicar el centro del círculo.';
    if (d.shape === 'polygon')
      return d.coordinates.length < 3
        ? `Toca el mapa para agregar vértices (${d.coordinates.length}/3 mínimo).`
        : 'Arrastra los vértices para ajustar o pulsa «Redibujar» para trazarla de nuevo.';
    return d.coordinates.length < 2
      ? 'Toca el mapa siguiendo la ruta autorizada (mínimo 2 puntos).'
      : 'Sigue agregando puntos sobre la ruta. Ajusta el ancho del corredor.';
  });
  readonly area = computed(() => {
    const d = this.draft();
    if (!d) return '';
    if (d.shape === 'freehand') return 'Sin trazo';
    if (d.shape === 'polygon' && d.coordinates.length >= 3)
      return `${fmt.num(polygonAreaKm2(d.coordinates), 2)} km² · ${d.coordinates.length} vértices`;
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
    effect(() => this.armFreehand(this.draft()?.shape === 'freehand'));
    effect(() => {
      const dark = this.theme.isDark();
      if (this.map) this.setBase(dark);
    });
  }

  private base?: L.TileLayer;
  private setBase(dark: boolean) {
    this.base?.remove();
    this.base = tileLayer(dark ? 'dark' : 'osm', this.map);
    this.base.bringToBack();
  }

  async ngAfterViewInit() {
    this.map = createMap(this.mapEl().nativeElement, { zoom: 13 });
    this.setBase(this.theme.isDark());
    L.control.zoom({ position: 'topright' }).addTo(this.map);
    this.layers.addTo(this.map);
    this.draftLayer.addTo(this.map);
    this.map.on('click', (e: L.LeafletMouseEvent) => this.onMapClick([e.latlng.lat, e.latlng.lng]));
    this.bindFreehand();
    this.armFreehand(this.draft()?.shape === 'freehand');
    this.map.on(
      'zoomend',
      () => this.draft()?.shape === 'corridor' && this.renderDraft(this.draft()),
    );
    this.ro = new ResizeObserver(() => this.map.invalidateSize());
    this.ro.observe(this.mapEl().nativeElement);
    await this.load();
  }

  ngOnDestroy() {
    this.unbindFreehand?.();
    this.ro?.disconnect();
    this.map?.remove();
  }

  async load() {
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
    // En móvil el panel tapa la parte de abajo: la geocerca se encuadra en la zona que queda a la vista.
    const mobile = window.innerWidth <= 760;
    if (b)
      this.map.flyToBounds(b.pad(0.3), {
        duration: 0.7,
        paddingTopLeft: [mobile ? 0 : 380, 0],
        paddingBottomRight: [0, mobile ? this.panelH() + 8 : 0],
      });
  }

  startCreate() {
    this.error.set('');
    this.draft.set({
      id: null,
      name: '',
      description: '',
      shape: 'freehand',
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
      shape: g.shape as Shape,
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

  /** Redibujar: los polígonos vuelven al modo de dibujo libre. */
  clearShape() {
    const d = this.draft();
    this.update({ coordinates: [], center: null, shape: d?.shape === 'polygon' ? 'freehand' : d?.shape });
  }

  /* ---------- Dibujo libre: arrastrar sobre el mapa traza el perímetro ---------- */
  private sketch?: L.Polyline;
  private sketchPts: L.LatLng[] = [];
  private suppressClickUntil = 0;
  private unbindFreehand?: () => void;

  /** Mientras se espera el trazo el mapa no se arrastra (en el celular el dedo dibuja en vez de mover). */
  private armFreehand(armed: boolean) {
    if (!this.map) return;
    this.mapEl().nativeElement.classList.toggle('freehand', armed);
    if (armed) this.map.dragging.disable();
    else this.map.dragging.enable();
  }

  private bindFreehand() {
    const el = this.mapEl().nativeElement;
    let drawing = false;
    let raf = 0;
    const isUi = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest('.leaflet-control, .leaflet-marker-icon');
    const down = (e: PointerEvent) => {
      if (this.draft()?.shape !== 'freehand' || isUi(e.target) || e.button > 0) return;
      e.preventDefault();
      drawing = true;
      el.setPointerCapture(e.pointerId);
      this.sketchPts = [this.map.mouseEventToLatLng(e)];
      this.sketch?.remove();
      this.sketch = L.polyline(this.sketchPts, {
        color: this.draft()!.color,
        weight: 3,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
      }).addTo(this.map);
    };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      const p = this.map.mouseEventToLatLng(e);
      const last = this.sketchPts[this.sketchPts.length - 1];
      if (this.map.latLngToContainerPoint(last).distanceTo(this.map.latLngToContainerPoint(p)) < 3) return;
      this.sketchPts.push(p);
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          this.sketch?.setLatLngs(this.sketchPts);
        });
    };
    const up = () => {
      if (!drawing) return;
      drawing = false;
      this.suppressClickUntil = Date.now() + 400;
      const pts = this.simplify(this.sketchPts);
      this.sketch?.remove();
      this.sketch = undefined;
      if (pts.length < 3) {
        this.toasts.info('Trazo muy corto', 'Mantén presionado y rodea la zona completa.');
        return;
      }
      this.update({ shape: 'polygon', coordinates: pts });
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    this.unbindFreehand = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }

  /** Douglas-Peucker en píxeles de pantalla: polígono liviano (máx. 60 vértices) fiel al trazo. */
  private simplify(pts: L.LatLng[]): LatLng[] {
    if (pts.length < 3) return pts.map((p) => [p.lat, p.lng] as LatLng);
    const xy = pts.map((p) => this.map.latLngToContainerPoint(p));
    let tol = 4;
    let keep: number[];
    do {
      keep = douglasPeucker(xy, tol);
      tol *= 1.5;
    } while (keep.length > 60);
    return keep.map((i) => [Number(pts[i].lat.toFixed(6)), Number(pts[i].lng.toFixed(6))] as LatLng);
  }

  toggleVehicle(id: string, on: boolean) {
    const d = this.draft();
    if (!d) return;
    this.update({ vehicleIds: on ? [...d.vehicleIds, id] : d.vehicleIds.filter((x) => x !== id) });
  }

  private onMapClick(p: LatLng) {
    const d = this.draft();
    if (!d || d.shape === 'freehand' || Date.now() < this.suppressClickUntil) return;
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
    if (d.shape === 'freehand') {
      this.error.set('Dibuja el perímetro de la geocerca sobre el mapa antes de guardar.');
      this.busy.set(false);
      return;
    }
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

/** Índices de los puntos que conserva Douglas-Peucker con tolerancia `tol` (px). */
function douglasPeucker(p: L.Point[], tol: number): number[] {
  const keep = new Set<number>([0, p.length - 1]);
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(p[i], p[a], p[b]);
      if (d > max) [max, idx] = [d, i];
    }
    if (idx > 0 && max > tol) {
      keep.add(idx);
      stack.push([a, idx], [idx, b]);
    }
  }
  return [...keep].sort((x, y) => x - y);
}

function segDist(p: L.Point, a: L.Point, b: L.Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Área aproximada (km²) de un polígono con proyección equirectangular local. */
function polygonAreaKm2(c: LatLng[]): number {
  const R = 6371.0088;
  const lat0 = (c.reduce((s, p) => s + p[0], 0) / c.length) * (Math.PI / 180);
  const xy = c.map(([la, ln]) => [((ln * Math.PI) / 180) * Math.cos(lat0) * R, ((la * Math.PI) / 180) * R]);
  let a = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) a += xy[j][0] * xy[i][1] - xy[i][0] * xy[j][1];
  return Math.abs(a) / 2;
}
