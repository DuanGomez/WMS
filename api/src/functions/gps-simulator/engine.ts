import fs from 'node:fs';
import path from 'node:path';
import {
  angleDiff,
  bearing,
  cumulativeDistances,
  destination,
  haversine,
  LatLng,
  pointAlong,
} from '../../shared/geo';
import { SimVehicleConfig, ScenarioType } from './fleet';
import { LA72 } from './waypoints';

/**
 * Motor del simulador GPS: recorre SIEMPRE la misma polilínea estática (route-medellin.geojson) en bucle,
 * con velocidad realista (más lenta en curvas, semáforos y parada de entrega) y escenarios de demo.
 */
export interface Route {
  points: LatLng[];
  cumulative: number[];
  length: number;
}

export function loadRoute(): Route {
  const file = path.join(__dirname, 'route-medellin.geojson');
  const gj = JSON.parse(fs.readFileSync(file, 'utf8'));
  const coords: [number, number][] = gj.features[0].geometry.coordinates;
  const points: LatLng[] = coords.map(([lng, lat]) => [lat, lng]);
  const cumulative = cumulativeDistances(points);
  return { points, cumulative, length: cumulative[cumulative.length - 1] };
}

interface Detour {
  path: LatLng[];
  cumulative: number[];
  d: number;
  rejoinM: number;
  ignition: boolean;
}

export interface SimPayload {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  battery: number;
  accuracy: number;
  ignition: boolean;
  timestamp: string;
}

export class SimVehicle {
  distance: number;
  speed = 0;
  heading = 0;
  t = Math.random() * 1000;
  stopUntil = 0;
  scenario: { type: ScenarioType; until: number } | null = null;
  detour: Detour | null = null;
  laps = 0;
  private lastStopMarker = -1;
  private phase = Math.random() * Math.PI * 2;

  constructor(
    public cfg: SimVehicleConfig,
    private route: Route,
  ) {
    this.distance = cfg.startM % route.length;
  }

  get mode(): string {
    if (this.scenario) return this.scenario.type;
    if (this.stopUntil > this.t) return 'stopped';
    return 'route';
  }

  get progress(): number {
    return Math.round((this.distance / this.route.length) * 1000) / 10;
  }

  /** Posición actual sobre la ruta o el desvío. */
  position(): LatLng {
    if (this.detour)
      return pointAlong(
        this.detour.path,
        this.detour.cumulative,
        Math.min(this.detour.d, this.detour.cumulative.at(-1)!),
      ).point;
    return pointAlong(this.route.points, this.route.cumulative, this.distance).point;
  }

  private ahead(meters: number): LatLng {
    return pointAlong(this.route.points, this.route.cumulative, this.distance + meters * this.cfg.direction)
      .point;
  }

  /** Curvatura próxima: diferencia de rumbo en los siguientes 40 m. */
  private curvature(): number {
    const p0 = this.position();
    const p1 = this.ahead(20);
    const p2 = this.ahead(45);
    if (haversine(p0, p1) < 2 || haversine(p1, p2) < 2) return 0;
    return angleDiff(bearing(p0, p1), bearing(p1, p2));
  }

  startScenario(type: ScenarioType, durationS: number) {
    this.scenario = { type, until: this.t + durationS };
    if (type === 'deviation' || type === 'theft') {
      const here = this.position();
      const fwd = bearing(here, this.ahead(30));
      const side = fwd + 90;
      const out = type === 'theft' ? 1100 : 450;
      const rejoinAhead = type === 'theft' ? 0 : 320;
      const far = destination(here, side, out);
      const mid = destination(destination(here, fwd, rejoinAhead / 2), side, out * 0.95);
      const rejoinM = this.distance + rejoinAhead * this.cfg.direction;
      const rejoin = pointAlong(this.route.points, this.route.cumulative, rejoinM).point;
      const pathPts =
        type === 'theft' ? [here, far, destination(far, fwd, 250), rejoin] : [here, far, mid, rejoin];
      this.detour = {
        path: pathPts,
        cumulative: cumulativeDistances(pathPts),
        d: 0,
        rejoinM,
        ignition: type !== 'theft',
      };
    }
  }

  /** Avanza dt segundos simulados. Devuelve null si el GPS no transmite (pérdida de señal). */
  tick(dt: number, realDt: number): SimPayload | null {
    this.t += dt;
    if (this.scenario && this.t >= this.scenario.until && !this.detour) this.scenario = null;
    // Los escenarios cuentan en tiempo real para que la demo sea predecible aunque se acelere la simulación.
    if (this.scenario) this.scenario.until += dt - realDt;

    const sc = this.scenario?.type;
    let target: number;
    if (sc === 'stop' || this.stopUntil > this.t) {
      target = 0;
    } else if (sc === 'theft') {
      target = 48 + 4 * Math.sin(this.t / 7);
    } else {
      const c = this.cfg;
      target = c.cruise + 6 * Math.sin(this.t / 37 + this.phase) + 3 * Math.sin(this.t / 11 + this.phase * 2);
      const curve = this.detour ? 0 : this.curvature();
      if (curve > 55) target = Math.min(target, 13);
      else if (curve > 30) target = Math.min(target, 19);
      else if (curve > 15) target = Math.min(target, 26);
      target = Math.max(c.minSpeed * (curve > 30 ? 0.6 : 1), Math.min(c.maxSpeed, target));
    }
    // Aceleración / frenado suaves (km/h por segundo)
    const accel = target > this.speed ? 3 : 7;
    this.speed += Math.max(-accel * dt, Math.min(accel * dt, target - this.speed));
    if (this.speed < 0.5 && target === 0) this.speed = 0;

    const prev = this.position();
    const meters = (this.speed / 3.6) * dt;
    if (this.detour) {
      this.detour.d += meters;
      if (this.detour.d >= this.detour.cumulative.at(-1)!) {
        this.distance = this.detour.rejoinM;
        this.detour = null;
        if (this.scenario && (this.scenario.type === 'deviation' || this.scenario.type === 'theft'))
          this.scenario = null;
      }
    } else {
      const before = this.distance;
      this.distance =
        (((this.distance + meters * this.cfg.direction) % this.route.length) + this.route.length) %
        this.route.length;
      if (this.cfg.direction === 1 ? this.distance < before : this.distance > before) this.laps++;
      this.checkStops(before);
    }
    const now = this.position();
    if (haversine(prev, now) > 0.5) this.heading = bearing(prev, now);

    if (sc === 'signal_loss') return null;
    // Ruido GPS realista (±2 m) y precisión variable
    const jitter = () => (Math.random() - 0.5) * 0.000036;
    const battery = Math.round(88 + 9 * Math.sin(this.t / 900 + this.phase));
    return {
      lat: Number((now[0] + jitter()).toFixed(6)),
      lng: Number((now[1] + jitter()).toFixed(6)),
      speed:
        Math.round(Math.max(0, this.speed + (this.speed > 1 ? (Math.random() - 0.5) * 1.5 : 0)) * 10) / 10,
      heading: Math.round(this.heading),
      battery,
      accuracy: Math.round(3 + Math.random() * 5),
      ignition: this.detour ? this.detour.ignition : true,
      timestamp: new Date().toISOString(),
    };
  }

  /** Semáforos deterministas cada ~1,7 km y parada de entrega en la 72. */
  private checkStops(before: number) {
    const crossed = (mark: number) =>
      this.cfg.direction === 1
        ? before < mark && this.distance >= mark
        : before > mark && this.distance <= mark;
    const LIGHT_EVERY = 1700;
    const marker = Math.floor(this.distance / LIGHT_EVERY);
    if (marker !== this.lastStopMarker) {
      const mark = (this.cfg.direction === 1 ? marker : marker + 1) * LIGHT_EVERY;
      if (this.lastStopMarker !== -1 && crossed(mark)) this.stopUntil = this.t + 6 + (marker % 4);
      this.lastStopMarker = marker;
    }
    if (this.cfg.deliveryStop && crossed(la72Distance(this.route))) this.stopUntil = this.t + 14;
  }
}

let la72Cache: number | null = null;
export function la72Distance(route: Route): number {
  if (la72Cache != null) return la72Cache;
  let best = 0;
  let bestD = Infinity;
  route.points.forEach((p, i) => {
    const d = haversine(p, LA72);
    if (d < bestD) {
      bestD = d;
      best = route.cumulative[i];
    }
  });
  la72Cache = best;
  return best;
}
