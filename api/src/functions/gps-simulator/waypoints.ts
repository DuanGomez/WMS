import { LatLng } from '../../shared/geo';

/**
 * Puntos de referencia de la ruta demo (circular) por Medellín. El script scripts/build-route.ts
 * los envía a OSRM para obtener la polilínea sobre vías reales.
 */
export const ROUTE_WAYPOINTS: { name: string; at: LatLng }[] = [
  { name: 'Parque Lleras / El Poblado', at: [6.2088, -75.568] },
  { name: 'Estación Poblado del Metro (Av. Las Vegas)', at: [6.2105, -75.57646] },
  { name: 'Av. El Poblado (hacia el norte)', at: [6.22897, -75.5688] },
  { name: 'Estación San Antonio', at: [6.247, -75.5686] },
  { name: 'Parque Berrío', at: [6.25121, -75.56747] },
  { name: 'Universidad de Antioquia (Calle 69)', at: [6.26654, -75.56499] },
  { name: 'Estadio Atanasio Girardot (Carrera 70)', at: [6.25535, -75.5877] },
  { name: 'Carrera 72 / Supermercados la 72', at: [6.253, -75.592] },
  { name: 'Segundo Parque de Laureles', at: [6.2456, -75.59] },
  { name: 'Av. 33', at: [6.2415, -75.584] },
  { name: 'Av. Regional (hacia el sur)', at: [6.226, -75.5765] },
];

/** Punto de Supermercados la 72 (geocerca circular y parada de entrega del simulador). */
export const LA72: LatLng = [6.253, -75.592];
