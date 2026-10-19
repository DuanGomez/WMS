import { all, get, id, run } from '../db';

/** Colombia (America/Bogota) es UTC-5 sin horario de verano. */
export const BOGOTA_OFFSET_MS = 5 * 3600_000;
export function bogotaDayStart(d = new Date()): Date {
  const local = new Date(d.getTime() - BOGOTA_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + BOGOTA_OFFSET_MS);
}
export function bogotaHour(d = new Date()): number {
  return new Date(d.getTime() - BOGOTA_OFFSET_MS).getUTCHours();
}

export interface PositionInput {
  companyId: string;
  vehicleId: string;
  deviceId: string;
  tripId: string | null;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  accuracy: number;
  battery: number | null;
  ignition: boolean;
  ts: string;
}

export interface TripDto {
  id: string;
  vehicleId: string;
  vehiclePlate?: string;
  vehicleType?: string;
  driverId: string | null;
  driverName?: string | null;
  startedAt: string;
  endedAt: string | null;
  distanceKm: number;
  maxSpeed: number;
  avgSpeed: number;
  movingMinutes: number;
  stoppedMinutes: number;
  points: number;
  status: 'open' | 'closed';
  alerts?: number;
}

export const mapTrip = (r: any): TripDto => {
  const movingH = r.moving_seconds / 3600;
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    vehiclePlate: r.plate,
    vehicleType: r.vtype,
    driverId: r.driver_id,
    driverName: r.driver_name ?? null,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    distanceKm: Math.round(r.distance_m / 10) / 100,
    maxSpeed: Math.round(r.max_speed),
    avgSpeed: movingH > 0 ? Math.round(r.distance_m / 1000 / movingH) : 0,
    movingMinutes: Math.round(r.moving_seconds / 60),
    stoppedMinutes: Math.round(r.stopped_seconds / 60),
    points: r.points,
    status: r.status,
    alerts: r.alerts_count ?? undefined,
  };
};

const TRIP_SQL = `SELECT t.*, v.plate, v.type AS vtype, u.name AS driver_name,
    (SELECT COUNT(*) FROM alerts a WHERE a.trip_id = t.id) AS alerts_count
  FROM trips t JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN users u ON u.id = t.driver_id
  WHERE t.company_id = @cid`;

export interface TripFilter {
  vehicleId?: string;
  driverId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export const trackingRepo = {
  insertPosition(p: PositionInput) {
    run(
      `INSERT INTO positions (company_id, vehicle_id, device_id, trip_id, lat, lng, speed, heading, accuracy, battery, ignition, ts)
       VALUES (@companyId,@vehicleId,@deviceId,@tripId,@lat,@lng,@speed,@heading,@accuracy,@battery,@ignition,@ts)`,
      { ...p },
    );
  },

  live: (vehicleId: string) => get<any>(`SELECT * FROM vehicle_live WHERE vehicle_id=@v`, { v: vehicleId }),

  upsertLive(p: PositionInput, stoppedSince: string | null) {
    run(
      `INSERT INTO vehicle_live (vehicle_id, company_id, lat, lng, speed, heading, accuracy, battery, ignition, ts, stopped_since)
       VALUES (@vehicleId,@companyId,@lat,@lng,@speed,@heading,@accuracy,@battery,@ignition,@ts,@stopped)
       ON CONFLICT(vehicle_id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, speed=excluded.speed, heading=excluded.heading,
         accuracy=excluded.accuracy, battery=excluded.battery, ignition=excluded.ignition, ts=excluded.ts, stopped_since=excluded.stopped_since`,
      { ...p, stopped: stoppedSince },
    );
  },

  openTrip: (vehicleId: string) =>
    get<any>(`SELECT * FROM trips WHERE vehicle_id=@v AND status='open' ORDER BY started_at DESC LIMIT 1`, {
      v: vehicleId,
    }),

  startTrip(companyId: string, vehicleId: string, driverId: string | null, ts: string): string {
    const tid = id();
    run(
      `INSERT INTO trips (id, company_id, vehicle_id, driver_id, started_at, status) VALUES (@id,@cid,@vid,@did,@ts,'open')`,
      { id: tid, cid: companyId, vid: vehicleId, did: driverId, ts },
    );
    return tid;
  },

  closeTrip(tripId: string, ts: string) {
    run(`UPDATE trips SET status='closed', ended_at=@ts WHERE id=@id AND status='open'`, { id: tripId, ts });
  },

  addToTrip(tripId: string, deltaM: number, speed: number, dtS: number, moving: boolean) {
    run(
      `UPDATE trips SET distance_m = distance_m + @d, max_speed = MAX(max_speed, @s), points = points + 1,
         moving_seconds = moving_seconds + @mv, stopped_seconds = stopped_seconds + @st WHERE id=@id`,
      { id: tripId, d: deltaM, s: speed, mv: moving ? dtS : 0, st: moving ? 0 : dtS },
    );
  },

  /** Cierra recorridos sin datos recientes (lo invoca el watchdog). */
  closeStaleTrips(olderThan: string): number {
    return run(
      `UPDATE trips SET status='closed', ended_at=COALESCE((SELECT MAX(ts) FROM positions p WHERE p.trip_id = trips.id), started_at)
       WHERE status='open' AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.trip_id = trips.id AND p.ts > @t) AND started_at < @t`,
      { t: olderThan },
    ).changes;
  },

  trips(tenantId: string, f: TripFilter = {}): TripDto[] {
    return all(
      `${TRIP_SQL} AND (@vehicle IS NULL OR t.vehicle_id=@vehicle) AND (@driver IS NULL OR t.driver_id=@driver)
        AND (@from IS NULL OR t.started_at >= @from) AND (@to IS NULL OR t.started_at <= @to)
       ORDER BY t.started_at DESC LIMIT @limit`,
      {
        cid: tenantId,
        vehicle: f.vehicleId ?? null,
        driver: f.driverId ?? null,
        from: f.from ?? null,
        to: f.to ?? null,
        limit: f.limit ?? 200,
      },
    ).map(mapTrip);
  },

  trip(tenantId: string, tripId: string): TripDto | undefined {
    const r = get(`${TRIP_SQL} AND t.id=@id`, { cid: tenantId, id: tripId });
    return r ? mapTrip(r) : undefined;
  },

  tripPositions(tenantId: string, tripId: string) {
    return all<any>(
      `SELECT lat, lng, speed, heading, ts FROM positions WHERE company_id=@cid AND trip_id=@t ORDER BY ts`,
      { cid: tenantId, t: tripId },
    );
  },

  /** Estela de los últimos minutos para el mapa en vivo. */
  trail(tenantId: string, vehicleId: string, since: string, maxPoints = 400) {
    const rows = all<any>(
      `SELECT lat, lng, ts FROM positions WHERE company_id=@cid AND vehicle_id=@v AND ts >= @since ORDER BY ts`,
      { cid: tenantId, v: vehicleId, since },
    );
    const step = Math.max(1, Math.ceil(rows.length / maxPoints));
    return rows
      .filter((_, i) => i % step === 0 || i === rows.length - 1)
      .map((r) => [r.lat, r.lng] as [number, number]);
  },

  positionsRange(tenantId: string, vehicleId: string, from: string, to: string, maxPoints = 3000) {
    const rows = all<any>(
      `SELECT lat, lng, speed, heading, ts FROM positions WHERE company_id=@cid AND vehicle_id=@v AND ts BETWEEN @from AND @to ORDER BY ts`,
      { cid: tenantId, v: vehicleId, from, to },
    );
    const step = Math.max(1, Math.ceil(rows.length / maxPoints));
    return rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
  },

  /** KPIs y series para el dashboard. */
  dashboard(tenantId: string) {
    const today = bogotaDayStart().toISOString();
    const vehicles = get<any>(
      `SELECT COUNT(*) total,
         SUM(CASE WHEN d.connection='online' THEN 1 ELSE 0 END) online,
         SUM(CASE WHEN l.speed > 3 AND d.connection='online' THEN 1 ELSE 0 END) moving
       FROM vehicles v LEFT JOIN devices d ON d.id=v.device_id LEFT JOIN vehicle_live l ON l.vehicle_id=v.id
       WHERE v.company_id=@cid AND v.retired_at IS NULL`,
      { cid: tenantId },
    );
    const openAlerts = get<any>(
      `SELECT COUNT(*) n, SUM(CASE WHEN priority IN ('high','critical') THEN 1 ELSE 0 END) critical FROM alerts WHERE company_id=@cid AND attended=0`,
      { cid: tenantId },
    );
    const kmToday = get<any>(
      `SELECT COALESCE(SUM(distance_m),0) m FROM trips WHERE company_id=@cid AND started_at >= @t`,
      {
        cid: tenantId,
        t: today,
      },
    );
    const devices = get<any>(
      `SELECT COUNT(*) total,
         SUM(CASE WHEN status='faulty' OR (status='active' AND connection='offline') THEN 1 ELSE 0 END) failing
       FROM devices WHERE company_id=@cid AND status <> 'retired'`,
      { cid: tenantId },
    );
    const days: { day: string; km: number; alerts: number; trips: number }[] = [];
    const start = bogotaDayStart();
    for (let i = 6; i >= 0; i--) {
      const from = new Date(start.getTime() - i * 86400_000).toISOString();
      const to = new Date(start.getTime() - (i - 1) * 86400_000).toISOString();
      const t = get<any>(
        `SELECT COALESCE(SUM(distance_m),0) m, COUNT(*) n FROM trips WHERE company_id=@cid AND started_at >= @f AND started_at < @t`,
        {
          cid: tenantId,
          f: from,
          t: to,
        },
      );
      const a = get<any>(`SELECT COUNT(*) n FROM alerts WHERE company_id=@cid AND ts >= @f AND ts < @t`, {
        cid: tenantId,
        f: from,
        t: to,
      });
      days.push({ day: from, km: Math.round(t.m / 100) / 10, trips: t.n, alerts: a.n });
    }
    const alertsByType = all<any>(
      `SELECT type, COUNT(*) n FROM alerts WHERE company_id=@cid AND ts >= @f GROUP BY type ORDER BY n DESC`,
      { cid: tenantId, f: new Date(start.getTime() - 6 * 86400_000).toISOString() },
    );
    const topVehicles = all<any>(
      `SELECT v.id, v.plate, v.type, COALESCE(SUM(t.distance_m),0) m FROM vehicles v
       LEFT JOIN trips t ON t.vehicle_id=v.id AND t.started_at >= @f
       WHERE v.company_id=@cid AND v.retired_at IS NULL GROUP BY v.id ORDER BY m DESC LIMIT 5`,
      { cid: tenantId, f: new Date(start.getTime() - 6 * 86400_000).toISOString() },
    );
    return {
      vehicles: { total: vehicles.total ?? 0, online: vehicles.online ?? 0, moving: vehicles.moving ?? 0 },
      openAlerts: { total: openAlerts.n ?? 0, critical: openAlerts.critical ?? 0 },
      kmToday: Math.round(kmToday.m / 100) / 10,
      devices: { total: devices.total ?? 0, failing: devices.failing ?? 0 },
      days,
      alertsByType: alertsByType.map((r) => ({ type: r.type, count: r.n })),
      topVehicles: topVehicles.map((r) => ({
        id: r.id,
        plate: r.plate,
        type: r.type,
        km: Math.round(r.m / 100) / 10,
      })),
    };
  },

  /**
   * Analítica por periodo para "Actividad de la flota".
   * days = 7 | 30 | 90. Buckets diarios (7 y 30) o semanales (90), en hora de Bogotá.
   * Devuelve el periodo actual, el anterior (misma duración) y el top 5 de conductores por km.
   */
  analytics(tenantId: string, days: 7 | 30 | 90) {
    const DAY = 86400_000;
    const bucketDays = days === 90 ? 7 : 1;
    const buckets = Math.ceil(days / bucketDays);
    const end = new Date(bogotaDayStart().getTime() + DAY); // mañana 00:00 Bogotá
    const start = new Date(end.getTime() - buckets * bucketDays * DAY);
    const prevStart = new Date(start.getTime() - buckets * bucketDays * DAY);
    const sum = (f: Date, t: Date) =>
      get<any>(
        `SELECT COALESCE(SUM(distance_m),0) m, COUNT(*) n FROM trips
         WHERE company_id=@cid AND started_at >= @f AND started_at < @t`,
        { cid: tenantId, f: f.toISOString(), t: t.toISOString() },
      );
    const series = (from: Date) => {
      const out: { day: string; km: number; trips: number }[] = [];
      for (let i = 0; i < buckets; i++) {
        const f = new Date(from.getTime() + i * bucketDays * DAY);
        const t = new Date(f.getTime() + bucketDays * DAY);
        const r = sum(f, t);
        out.push({ day: f.toISOString(), km: Math.round(r.m / 100) / 10, trips: r.n });
      }
      return out;
    };
    const cur = series(start);
    const prev = series(prevStart);
    const topDrivers = all<any>(
      `SELECT u.id, u.name, COALESCE(SUM(t.distance_m),0) m, COUNT(t.id) n
       FROM trips t JOIN users u ON u.id = t.driver_id
       WHERE t.company_id=@cid AND t.started_at >= @f AND t.started_at < @t
       GROUP BY u.id ORDER BY m DESC LIMIT 5`,
      { cid: tenantId, f: start.toISOString(), t: end.toISOString() },
    );
    const tot = (l: { km: number; trips: number }[]) => ({
      km: Math.round(l.reduce((s, x) => s + x.km, 0) * 10) / 10,
      trips: l.reduce((s, x) => s + x.trips, 0),
    });
    return {
      range: days,
      bucket: bucketDays === 1 ? 'day' : 'week',
      days: cur,
      prevDays: prev,
      totals: { ...tot(cur), prevKm: tot(prev).km, prevTrips: tot(prev).trips },
      topDrivers: topDrivers.map((r) => ({
        id: r.id,
        name: r.name,
        km: Math.round(r.m / 100) / 10,
        trips: r.n,
      })),
    };
  },
};
