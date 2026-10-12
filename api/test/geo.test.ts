import { describe, expect, it } from 'vitest';
import {
  destination,
  distanceToPolyline,
  haversine,
  isInside,
  LatLng,
  pointInCircle,
  pointInPolygon,
} from '../src/shared/geo';

const LA72: LatLng = [6.253, -75.592];
const SQUARE: LatLng[] = [
  [6.25, -75.6],
  [6.25, -75.59],
  [6.26, -75.59],
  [6.26, -75.6],
];

describe('geo – utilidades de geocercas (RE2, RE3)', () => {
  it('haversine: Parque Lleras → Parque Berrío ≈ 4,8 km', () => {
    const d = haversine([6.2088, -75.568], [6.2518, -75.5687]);
    expect(d).toBeGreaterThan(4700);
    expect(d).toBeLessThan(4900);
  });

  it('punto en círculo respeta el radio', () => {
    expect(pointInCircle(destination(LA72, 90, 200), LA72, 220)).toBe(true);
    expect(pointInCircle(destination(LA72, 90, 240), LA72, 220)).toBe(false);
  });

  it('punto en polígono (ray casting), incluido polígono no cerrado', () => {
    expect(pointInPolygon([6.255, -75.595], SQUARE)).toBe(true);
    expect(pointInPolygon([6.265, -75.595], SQUARE)).toBe(false);
    expect(pointInPolygon([6.255, -75.585], SQUARE)).toBe(false);
  });

  it('polígono cóncavo (forma de L)', () => {
    const L: LatLng[] = [
      [0, 0],
      [0, 2],
      [1, 2],
      [1, 1],
      [2, 1],
      [2, 0],
    ];
    expect(pointInPolygon([0.5, 1.5], L)).toBe(true);
    expect(pointInPolygon([1.5, 1.5], L)).toBe(false);
  });

  it('corredor de ruta: distancia a la polilínea', () => {
    const line: LatLng[] = [
      [6.25, -75.6],
      [6.25, -75.59],
    ];
    const near = destination([6.25, -75.595], 0, 80);
    const far = destination([6.25, -75.595], 0, 300);
    expect(distanceToPolyline(near, line)).toBeGreaterThan(75);
    expect(distanceToPolyline(near, line)).toBeLessThan(85);
    expect(isInside(near, { shape: 'corridor', coordinates: line, radiusM: 120 })).toBe(true);
    expect(isInside(far, { shape: 'corridor', coordinates: line, radiusM: 120 })).toBe(false);
  });

  it('isInside despacha por forma', () => {
    expect(isInside(LA72, { shape: 'circle', center: LA72, radiusM: 10, coordinates: [] })).toBe(true);
    expect(isInside([6.255, -75.595], { shape: 'polygon', coordinates: SQUARE })).toBe(true);
  });
});
