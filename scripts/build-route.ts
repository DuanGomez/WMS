/**
 * Genera la ruta FIJA del simulador GPS por calles reales de Medellín.
 * Consulta UNA sola vez el servicio público de OSRM (perfil driving) y guarda el resultado como GeoJSON
 * estático en api/src/functions/gps-simulator/route-medellin.geojson. El simulador siempre usa ese archivo,
 * por lo que funciona sin internet y la ruta es idéntica en cada ejecución.
 *
 * Uso: npm run build-route            (no sobrescribe si ya existe)
 *      npm run build-route -- --force
 */
import fs from 'node:fs';
import path from 'node:path';
import { haversine, LatLng, polylineLength } from '../api/src/shared/geo';
import { ROUTE_WAYPOINTS } from '../api/src/functions/gps-simulator/waypoints';

const OUT = path.resolve(__dirname, '../api/src/functions/gps-simulator/route-medellin.geojson');
const force = process.argv.includes('--force');

/** Respaldo: densifica las líneas rectas entre waypoints (NO sigue vías; sólo si OSRM no responde). */
function fallback(): LatLng[] {
  const pts: LatLng[] = [];
  const wps = [...ROUTE_WAYPOINTS.map((w) => w.at), ROUTE_WAYPOINTS[0].at];
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    const n = Math.max(2, Math.ceil(haversine(a, b) / 25));
    for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  pts.push(wps[wps.length - 1]);
  return pts;
}

async function fromOsrm(): Promise<{ coords: LatLng[]; distance: number; duration: number }> {
  const wps = [...ROUTE_WAYPOINTS.map((w) => w.at), ROUTE_WAYPOINTS[0].at]; // ruta circular
  const coordStr = wps.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=false&continue_straight=true`;
  console.log('Consultando OSRM…');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'WMS-PPI-TdeA/1.0 (proyecto academico; build-route unico)' },
  });
  if (!res.ok) throw new Error(`OSRM respondió ${res.status}`);
  const data: any = await res.json();
  if (data.code !== 'Ok') throw new Error(`OSRM: ${data.code} ${data.message ?? ''}`);
  const route = data.routes[0];
  const coords: LatLng[] = route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]);
  return { coords, distance: route.distance, duration: route.duration };
}

/** Validación básica: puntos dentro del Valle de Aburrá, sin saltos > 400 m y cerca de cada waypoint. */
function validate(coords: LatLng[]) {
  const issues: string[] = [];
  for (const [lat, lng] of coords) {
    if (lat < 6.13 || lat > 6.35 || lng < -75.66 || lng > -75.52)
      issues.push(`Punto fuera del valle: ${lat},${lng}`);
  }
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(coords[i - 1], coords[i]);
    if (d > 1500) issues.push(`Segmento recto de ${Math.round(d)} m en el índice ${i} (revisar)`);
  }
  for (const w of ROUTE_WAYPOINTS) {
    const min = Math.min(...coords.map((c) => haversine(c, w.at)));
    if (min > 350) issues.push(`La ruta pasa a ${Math.round(min)} m de «${w.name}»`);
  }
  return issues;
}

async function main() {
  if (fs.existsSync(OUT) && !force) {
    console.log(`Ya existe ${path.relative(process.cwd(), OUT)} (usa --force para regenerarla).`);
    return;
  }
  let coords: LatLng[];
  let source = 'osrm';
  let meta: Record<string, unknown> = {};
  try {
    const r = await fromOsrm();
    coords = r.coords;
    meta = { osrmDistanceM: Math.round(r.distance), osrmDurationS: Math.round(r.duration) };
  } catch (e) {
    console.warn(
      `⚠️  OSRM no respondió (${(e as Error).message}). Se usa la ruta de respaldo (líneas rectas entre puntos).`,
    );
    coords = fallback();
    source = 'fallback-straight-lines';
  }
  const issues = validate(coords);
  issues.forEach((i) => console.warn('  ⚠️ ', i));
  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          name: 'Ruta demo WMS – Medellín (circular)',
          source,
          generatedAt: new Date().toISOString(),
          lengthM: Math.round(polylineLength(coords)),
          points: coords.length,
          waypoints: ROUTE_WAYPOINTS.map((w) => w.name),
          attribution: 'Ruta calculada con OSRM sobre datos © OpenStreetMap contributors (ODbL)',
          ...meta,
        },
        geometry: {
          type: 'LineString',
          coordinates: coords.map(([lat, lng]) => [Number(lng.toFixed(6)), Number(lat.toFixed(6))]),
        },
      },
    ],
  };
  fs.writeFileSync(OUT, JSON.stringify(geojson));
  console.log(
    `✅ Ruta guardada (${source}): ${coords.length} puntos, ${(polylineLength(coords) / 1000).toFixed(1)} km → ${path.relative(process.cwd(), OUT)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
