import { subscribe } from '../../shared/bus';
import { all } from '../../shared/db';
import { Ctx, defineHttp, defineStream, ok } from '../../shared/http';
import { alertsRepo } from '../../shared/repositories/alerts';
import { vehiclesRepo } from '../../shared/repositories/fleet';
import { geofencesRepo } from '../../shared/repositories/geofences';
import { trackingRepo } from '../../shared/repositories/tracking';

/**
 * tracking-stream (RG2): tiempo real hacia el frontend.
 *  - GET tracking/stream  → Server-Sent Events (position, alert, device, notification) filtrados por tenant.
 *  - GET tracking/poll    → fallback por polling (posiciones y alertas desde `since`).
 *  - GET tracking/live    → snapshot inicial del mapa (vehículos + estelas + geocercas).
 */
const TRAIL_MINUTES = 10;

/** Conductores: sólo su vehículo. */
function visibleVehicleIds(ctx: Ctx): Set<string> | null {
  if (ctx.user.role !== 'driver') return null;
  return new Set(vehiclesRepo.list(ctx.tenantId, { driverId: ctx.user.id }).map((v) => v.id));
}

defineHttp({
  name: 'tracking-live',
  route: 'tracking/live',
  methods: ['GET'],
  guard: { module: 'map', level: 'read' },
  handler: (_req, ctx) => {
    const allowed = visibleVehicleIds(ctx);
    const since = new Date(Date.now() - TRAIL_MINUTES * 60_000).toISOString();
    const vehicles = vehiclesRepo
      .list(ctx.tenantId)
      .filter((v) => !allowed || allowed.has(v.id))
      .map((v) => ({ ...v, trail: trackingRepo.trail(ctx.tenantId, v.id, since) }));
    const canSeeGeofences = ctx.user.permissions.geofences !== 'none';
    return ok({
      serverTime: new Date().toISOString(),
      trailMinutes: TRAIL_MINUTES,
      vehicles,
      geofences: canSeeGeofences ? geofencesRepo.list(ctx.tenantId, { onlyActive: true }) : [],
      openAlerts:
        ctx.user.permissions.alerts !== 'none'
          ? alertsRepo.list(ctx.tenantId, { attended: false, limit: 20 })
          : null,
    });
  },
});

defineStream({
  name: 'tracking-stream',
  route: 'tracking/stream',
  guard: { module: 'map', level: 'read' },
  handler: (_req, ctx, send) => {
    const allowed = visibleVehicleIds(ctx);
    const canAlerts = ctx.user.permissions.alerts !== 'none';
    send('hello', { serverTime: new Date().toISOString(), tenant: ctx.tenantId });
    const off = subscribe(ctx.tenantId, (event, data) => {
      if (allowed && data?.vehicleId && !allowed.has(data.vehicleId)) return;
      if ((event === 'alert' || event === 'notification') && !canAlerts) return;
      send(event, data);
    });
    const ping = setInterval(() => send('ping', { t: Date.now() }), 15000);
    return () => {
      clearInterval(ping);
      off();
    };
  },
});

defineHttp({
  name: 'tracking-poll',
  route: 'tracking/poll',
  methods: ['GET'],
  guard: { module: 'map', level: 'read' },
  handler: (req, ctx) => {
    const since = req.query.get('since') ?? new Date(Date.now() - 5000).toISOString();
    const allowed = visibleVehicleIds(ctx);
    const positions = all<any>(
      `SELECT l.*, v.plate, v.type, v.device_id, u.name AS driver_name, d.connection FROM vehicle_live l
       JOIN vehicles v ON v.id = l.vehicle_id LEFT JOIN users u ON u.id = v.driver_id LEFT JOIN devices d ON d.id = v.device_id
       WHERE l.company_id = @cid AND l.ts > @since AND v.retired_at IS NULL`,
      { cid: ctx.tenantId, since },
    )
      .filter((r) => !allowed || allowed.has(r.vehicle_id))
      .map((r) => ({
        vehicleId: r.vehicle_id,
        plate: r.plate,
        type: r.type,
        deviceId: r.device_id,
        driverName: r.driver_name,
        lat: r.lat,
        lng: r.lng,
        speed: r.speed,
        heading: r.heading,
        accuracy: r.accuracy,
        battery: r.battery,
        ignition: !!r.ignition,
        ts: r.ts,
        stoppedSince: r.stopped_since,
        connection: r.connection,
      }));
    const alerts =
      ctx.user.permissions.alerts !== 'none'
        ? alertsRepo.list(ctx.tenantId, { from: since, limit: 50 }).items
        : [];
    return ok({ serverTime: new Date().toISOString(), positions, alerts });
  },
});

/* Dashboard: KPIs y series de los últimos 7 días */
defineHttp({
  name: 'dashboard',
  route: 'dashboard',
  methods: ['GET'],
  guard: { module: 'dashboard', level: 'read' },
  handler: (_req, ctx) => {
    const data = trackingRepo.dashboard(ctx.tenantId);
    const recentAlerts = alertsRepo.list(ctx.tenantId, { limit: 6 }).items;
    return ok({ ...data, recentAlerts });
  },
});

/* Analítica por periodo (Actividad de la flota) */
defineHttp({
  name: 'analytics',
  route: 'analytics',
  methods: ['GET'],
  guard: { module: 'dashboard', level: 'read' },
  handler: (req, ctx) => {
    const d = Number(req.query.get('days'));
    const days = (d === 30 || d === 90 ? d : 7) as 7 | 30 | 90;
    return ok(trackingRepo.analytics(ctx.tenantId, days));
  },
});
