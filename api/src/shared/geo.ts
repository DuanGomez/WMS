/** Utilidades geoespaciales puras (sin dependencias) usadas por geocercas, alertas, recorridos y el simulador. */
export type LatLng = [number, number]; // [lat, lng]

const R = 6371008.8; // radio medio terrestre (m)
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Distancia haversine en metros. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rumbo inicial (0-360°, 0 = norte). */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x =
    Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
    Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Punto dentro de círculo (centro + radio en metros). */
export function pointInCircle(p: LatLng, center: LatLng, radiusM: number): boolean {
  return haversine(p, center) <= radiusM;
}

/** Punto dentro de polígono (ray casting). El polígono puede venir cerrado o abierto. */
export function pointInPolygon(p: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  const [y, x] = p;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Proyección equirectangular local (suficiente para distancias < decenas de km). */
function toXY(p: LatLng, ref: LatLng): [number, number] {
  return [rad(p[1] - ref[1]) * Math.cos(rad(ref[0])) * R, rad(p[0] - ref[0]) * R];
}

/** Distancia mínima (m) de un punto a un segmento. */
export function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const [px, py] = toXY(p, a);
  const [bx, by] = toXY(b, a);
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const dx = px - t * bx;
  const dy = py - t * by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distancia mínima (m) de un punto a una polilínea. */
export function distanceToPolyline(p: LatLng, line: LatLng[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversine(p, line[0]);
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) min = Math.min(min, distanceToSegment(p, line[i], line[i + 1]));
  return min;
}

/** Longitud total de una polilínea en metros. */
export function polylineLength(line: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += haversine(line[i - 1], line[i]);
  return d;
}

/** Interpolación lineal entre dos puntos. */
export function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Punto a d metros sobre la polilínea (con distancias acumuladas precalculadas). */
export function pointAlong(
  line: LatLng[],
  cumulative: number[],
  d: number,
): { point: LatLng; index: number } {
  const total = cumulative[cumulative.length - 1];
  const dist = ((d % total) + total) % total;
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] <= dist) lo = mid;
    else hi = mid;
  }
  const seg = cumulative[hi] - cumulative[lo];
  const t = seg === 0 ? 0 : (dist - cumulative[lo]) / seg;
  return { point: lerp(line[lo], line[hi], t), index: lo };
}

export function cumulativeDistances(line: LatLng[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + haversine(line[i - 1], line[i]));
  return out;
}

/** Diferencia angular absoluta (0-180). */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export interface GeofenceShape {
  shape: 'circle' | 'polygon' | 'corridor';
  center?: LatLng | null;
  radiusM?: number | null;
  coordinates: LatLng[];
}

/**
 * Evalúa si un punto está "dentro" de una geocerca.
 * - circle: distancia al centro ≤ radio
 * - polygon: ray casting
 * - corridor: distancia a la polilínea ≤ radio (ancho medio del corredor)
 */
export function isInside(p: LatLng, g: GeofenceShape): boolean {
  switch (g.shape) {
    case 'circle':
      return !!g.center && pointInCircle(p, g.center, g.radiusM ?? 0);
    case 'polygon':
      return pointInPolygon(p, g.coordinates);
    case 'corridor':
      return distanceToPolyline(p, g.coordinates) <= (g.radiusM ?? 100);
  }
}

/** Punto de destino a `meters` metros con rumbo `bearingDeg` desde `p`. */
export function destination(p: LatLng, bearingDeg: number, meters: number): LatLng {
  const d = meters / R;
  const b = rad(bearingDeg);
  const lat1 = rad(p[0]);
  const lng1 = rad(p[1]);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 =
    lng1 +
    Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [deg(lat2), deg(lng2)];
}
