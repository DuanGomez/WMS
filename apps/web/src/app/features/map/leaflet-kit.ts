import * as L from 'leaflet';
import { VEHICLE_TYPES } from '../../core/format';
import { Geofence, LatLng } from '../../core/models';
import { iconSvg } from '../../ui/icon.component';

/** Medellín y límites razonables sobre el Valle de Aburrá. */
export const MEDELLIN: LatLng = [6.2442, -75.5812];
export const ABURRA_BOUNDS = L.latLngBounds([6.02, -75.78], [6.45, -75.38]);

export type BaseLayer = 'osm' | 'light' | 'dark';
/**
 * Todas las capas usan las teselas estándar de OpenStreetMap (sin API key). Las variantes clara y nocturna
 * se obtienen con un filtro CSS sobre la misma tesela (clases .tiles-light / .tiles-dark en styles.scss):
 * CARTO dejó de servir teselas sin llave.
 */
export const BASE_LAYERS: Record<
  BaseLayer,
  { label: string; url: string; attribution: string; className?: string; maxZoom: number }
> = {
  osm: {
    label: 'Estándar (OpenStreetMap)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
    maxZoom: 19,
  },
  light: {
    label: 'Claro (OpenStreetMap atenuado)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
    className: 'tiles-light',
    maxZoom: 19,
  },
  dark: {
    label: 'Oscuro (OpenStreetMap nocturno)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
    className: 'tiles-dark',
    maxZoom: 19,
  },
};

export function createMap(el: HTMLElement, opts: { zoom?: number; center?: LatLng } = {}): L.Map {
  const map = L.map(el, {
    center: opts.center ?? MEDELLIN,
    zoom: opts.zoom ?? 13,
    minZoom: 11,
    maxBounds: ABURRA_BOUNDS,
    maxBoundsViscosity: 0.8,
    zoomControl: false,
    attributionControl: true,
    zoomSnap: 0.25,
    zoomDelta: 0.75,
    wheelPxPerZoomLevel: 90,
    preferCanvas: false,
    // En pantallas táctiles las teselas aparecen sin fundido: menos repintados al desplazar el mapa en celulares.
    fadeAnimation: !window.matchMedia('(hover: none) and (pointer: coarse)').matches,
  });
  map.attributionControl.setPrefix(false);
  return map;
}

/** Agrega la capa base al mapa. El fondo del mapa toma el tono medio de esas teselas (data-base, styles.scss):
 *  mientras cargan no se ve un hueco negro o blanco que destelle al aparecer cada tesela. */
export function tileLayer(kind: BaseLayer, map: L.Map): L.TileLayer {
  const b = BASE_LAYERS[kind];
  map.getContainer().dataset['base'] = kind;
  return L.tileLayer(b.url, {
    attribution: b.attribution,
    maxZoom: b.maxZoom,
    className: b.className ?? '',
    crossOrigin: true,
  }).addTo(map);
}

/** Dibuja una geocerca (círculo, polígono o corredor de ruta). */
export function geofenceLayer(
  g: Pick<Geofence, 'shape' | 'center' | 'radiusM' | 'coordinates' | 'color' | 'name'>,
  opts: { label?: boolean; dim?: boolean } = {},
): L.Layer {
  const style: L.PathOptions = {
    color: g.color,
    weight: 2,
    opacity: opts.dim ? 0.5 : 0.9,
    fillColor: g.color,
    fillOpacity: opts.dim ? 0.05 : 0.1,
    dashArray: g.shape === 'corridor' ? undefined : '6 6',
  };
  let layer: L.Layer;
  if (g.shape === 'circle' && g.center)
    layer = L.circle(g.center, { ...style, radius: g.radiusM ?? 100 });
  else if (g.shape === 'polygon') layer = L.polygon(g.coordinates, style);
  else
    layer = L.polyline(g.coordinates, {
      color: g.color,
      opacity: opts.dim ? 0.18 : 0.28,
      weight: 16,
      lineCap: 'round',
      lineJoin: 'round',
    });
  if (opts.label)
    (layer as L.Path).bindTooltip(g.name, {
      className: 'gf-label',
      direction: 'center',
      permanent: false,
      sticky: true,
    });
  return layer;
}

/**
 * Marcador del vehículo estilo Apple Maps: punto con halo pulsante, cono de rumbo, etiqueta con placa
 * y animación interpolada entre posiciones (requestAnimationFrame, sin saltos).
 */
export class VehicleMarker {
  readonly marker: L.Marker;
  readonly trail: L.Polyline;
  private from: LatLng;
  private to: LatLng;
  private start = 0;
  private duration = 1000;
  private raf = 0;
  private heading = 0;
  private trailPts: { p: LatLng; t: number }[] = [];
  private el: HTMLElement | null = null;
  private state = '';

  constructor(
    private map: L.Map,
    public id: string,
    plate: string,
    type: string,
    at: LatLng,
    heading: number,
    private trailMinutes = 10,
    onClick?: () => void,
  ) {
    this.from = this.to = at;
    this.heading = heading;
    const icon = L.divIcon({
      className: '',
      iconSize: [0, 0],
      html: `<div class="veh"><div class="veh-halo"></div><div class="veh-cone"></div><div class="veh-dot">${iconSvg(VEHICLE_TYPES[type]?.icon ?? 'navigation', 11, 2.6)}</div><div class="veh-label">${plate}</div></div>`,
    });
    this.trail = L.polyline([], {
      color: '#007AFF',
      weight: 4,
      opacity: 0.55,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
    }).addTo(map);
    this.marker = L.marker(at, {
      icon,
      keyboard: true,
      title: plate,
      riseOnHover: true,
      zIndexOffset: 500,
    }).addTo(map);
    if (onClick) this.marker.on('click', onClick);
    this.marker.on('add', () => this.bindEl());
    this.bindEl();
  }

  private bindEl() {
    this.el = (this.marker.getElement()?.querySelector('.veh') as HTMLElement) ?? null;
    if (this.el) {
      this.el.style.setProperty('--heading', `${this.heading}deg`);
      if (this.state) this.el.className = `veh ${this.state}`;
      this.marker.getElement()?.setAttribute('aria-label', `Vehículo ${this.marker.options.title}`);
    }
  }

  setTrail(points: LatLng[]) {
    const now = Date.now();
    this.trailPts = points.map((p, i) => ({ p, t: now - (points.length - i) * 1000 }));
    this.trail.setLatLngs(points);
  }

  setState(opts: { selected?: boolean; stopped?: boolean; offline?: boolean; alarm?: boolean }) {
    const cls = [
      opts.selected && 'selected',
      opts.offline ? 'offline' : opts.alarm ? 'alarm' : opts.stopped && 'stopped',
    ]
      .filter(Boolean)
      .join(' ');
    this.state = cls;
    if (this.el) this.el.className = `veh ${cls}`;
    this.marker.setZIndexOffset(opts.selected ? 1000 : 500);
    const color = opts.offline ? '#8E8E93' : opts.alarm ? '#FF3B30' : '#007AFF';
    this.trail.setStyle({ color, opacity: opts.selected ? 0.75 : 0.5 });
  }

  /** Anima hasta la nueva posición en ~el intervalo entre reportes. */
  moveTo(p: LatLng, heading: number, intervalMs = 1000) {
    this.from = this.current();
    this.to = p;
    this.duration = Math.max(250, Math.min(2500, intervalMs));
    this.start = performance.now();
    this.setHeading(heading);
    const now = Date.now();
    this.trailPts.push({ p, t: now });
    const cutoff = now - this.trailMinutes * 60_000;
    while (this.trailPts.length && this.trailPts[0].t < cutoff) this.trailPts.shift();
    const px = this.map.latLngToLayerPoint(this.from).distanceTo(this.map.latLngToLayerPoint(this.to));
    this.msPerPx = this.duration / Math.max(px, 1e-6);
    clearTimeout(this.timer);
    this.timer = 0;
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private setHeading(h: number) {
    // rotación por el camino más corto
    let delta = ((h - (this.heading % 360) + 540) % 360) - 180;
    if (Math.abs(delta) < 0.5) delta = 0;
    this.heading += delta;
    this.el?.style.setProperty('--heading', `${this.heading}deg`);
  }

  private frame = (t: number) => {
    const k = Math.min(1, (t - this.start) / this.duration);
    const e = k; // velocidad constante: el movimiento entre reportes se ve continuo
    const lat = this.from[0] + (this.to[0] - this.from[0]) * e;
    const lng = this.from[1] + (this.to[1] - this.from[1]) * e;
    // Leaflet coloca el marcador en píxeles enteros: a velocidad de ciudad avanza 1–2 px por segundo, así que la
    // mayoría de los frames no cambian nada. Solo se redibuja (marcador y estela de ~600 puntos) al cambiar de píxel.
    const p = this.map.latLngToLayerPoint([lat, lng]).round();
    const px = `${p.x},${p.y}`;
    if (px !== this.lastPx || k >= 1) {
      this.lastPx = px;
      this.marker.setLatLng([lat, lng]);
      const pts = this.trailPts.map((x) => x.p);
      if (pts.length) pts[pts.length - 1] = [lat, lng];
      this.trail.setLatLngs(pts);
    }
    this.raf = 0;
    if (k >= 1) return;
    // Movimiento lento (menos de ~15 px/s, lo normal en ciudad): se espera medio píxel en lugar de pedir un frame
    // en cada vsync, que mantenía ocupado el hilo principal y sacaba de la GPU el halo y los pulsos.
    if (this.msPerPx > 68) {
      const wait = Math.min(this.msPerPx / 2, this.start + this.duration - performance.now());
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.raf = requestAnimationFrame(this.frame);
      }, Math.max(0, wait - 8));
    } else this.raf = requestAnimationFrame(this.frame);
  };
  private lastPx = '';
  private msPerPx = 0;
  private timer = 0;

  current(): LatLng {
    const ll = this.marker.getLatLng();
    return [ll.lat, ll.lng];
  }

  remove() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.marker.remove();
    this.trail.remove();
  }
}
