import { evaluatePosition, fireAlert } from './alert-engine';
import { publish } from './bus';
import { get, now, run, tx } from './db';
import { forbidden } from './errors';
import { bearing, haversine } from './geo';
import { alertsRepo } from './repositories/alerts';
import { trackingRepo } from './repositories/tracking';
import { z } from './validation';

/** Payload que envía el dispositivo GPS (RG8). */
export const ingestSchema = z.object({
  deviceId: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speed: z.number().min(0).max(250).default(0),
  heading: z.number().min(0).max(360).optional(),
  battery: z.number().min(0).max(100).nullable().optional(),
  accuracy: z.number().min(0).max(5000).default(5),
  ignition: z.boolean().default(true),
  timestamp: z.string().optional(),
});
export type IngestPayload = z.infer<typeof ingestSchema>;

const TRIP_GAP_MS = 5 * 60_000; // sin datos 5 min → nuevo recorrido
const TRIP_MAX_MS = 30 * 60_000; // segmenta recorridos largos cada 30 min (reportes legibles)
const STOP_SPEED = 2; // km/h

export interface LivePayload {
  vehicleId: string;
  plate: string;
  type: string;
  deviceId: string;
  driverName: string | null;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  accuracy: number;
  battery: number | null;
  ignition: boolean;
  ts: string;
  stoppedSince: string | null;
  connection: 'online' | 'offline';
}

/**
 * Procesa una posición: guarda histórico, actualiza recorrido y estado en vivo, evalúa reglas de alerta
 * y publica el evento hacia el stream en tiempo real.
 */
export function ingestPosition(device: any, payload: IngestPayload) {
  if (device.status === 'inactive')
    throw forbidden('El dispositivo está inactivo. Actívalo desde Dispositivos GPS.');
  const tenantId: string = device.company_id;
  const ts = (() => {
    const t = payload.timestamp ? Date.parse(payload.timestamp) : NaN;
    return Number.isFinite(t) && Math.abs(t - Date.now()) < 10 * 60_000 ? new Date(t).toISOString() : now();
  })();
  const wasOffline = device.connection === 'offline';

  const vehicle = get<any>(
    `SELECT v.*, u.name AS driver_name FROM vehicles v LEFT JOIN users u ON u.id = v.driver_id
     WHERE v.device_id = @d AND v.retired_at IS NULL`,
    { d: device.id },
  );

  return tx(() => {
    run(
      `UPDATE devices SET connection='online', last_seen_at=@ts, battery=COALESCE(@battery, battery), powered=1,
         status = CASE WHEN status='faulty' THEN 'active' ELSE status END, updated_at=@ts WHERE id=@id`,
      { ts, battery: payload.battery ?? null, id: device.id },
    );
    if (!vehicle) return { stored: false as const, reason: 'Dispositivo sin vehículo asociado', tenantId };

    const prev = trackingRepo.live(vehicle.id);
    const point: [number, number] = [payload.lat, payload.lng];
    const dtS = prev ? Math.max(0, Math.min(60, (Date.parse(ts) - Date.parse(prev.ts)) / 1000)) : 0;
    const delta = prev ? haversine([prev.lat, prev.lng], point) : 0;
    const heading =
      payload.heading ?? (prev && delta > 1 ? bearing([prev.lat, prev.lng], point) : (prev?.heading ?? 0));

    // Recorridos (Recorrido = composición de Ubicaciones)
    let trip = trackingRepo.openTrip(vehicle.id);
    const lastTs = prev ? Date.parse(prev.ts) : 0;
    if (
      trip &&
      (Date.parse(ts) - lastTs > TRIP_GAP_MS || Date.parse(ts) - Date.parse(trip.started_at) > TRIP_MAX_MS)
    ) {
      trackingRepo.closeTrip(trip.id, prev?.ts ?? ts);
      trip = undefined;
    }
    const tripId: string =
      trip?.id ?? trackingRepo.startTrip(tenantId, vehicle.id, vehicle.driver_id ?? null, ts);
    const moving = payload.speed >= STOP_SPEED;
    trackingRepo.addToTrip(tripId, trip ? delta : 0, payload.speed, trip ? dtS : 0, moving);

    const stoppedSince = moving ? null : (prev?.stopped_since ?? ts);
    const pos = {
      companyId: tenantId,
      vehicleId: vehicle.id,
      deviceId: device.id,
      tripId,
      lat: payload.lat,
      lng: payload.lng,
      speed: Math.round(payload.speed * 10) / 10,
      heading: Math.round(heading),
      accuracy: payload.accuracy,
      battery: payload.battery ?? null,
      ignition: payload.ignition,
      ts,
    };
    trackingRepo.insertPosition(pos);
    trackingRepo.upsertLive(pos, stoppedSince);

    const vctx = {
      id: vehicle.id,
      plate: vehicle.plate,
      type: vehicle.type,
      companyId: tenantId,
      deviceId: device.id,
      driverName: vehicle.driver_name,
    };

    if (wasOffline) {
      // Se rearma la regla de pérdida de señal y se informa la recuperación (alerta informativa ya atendida).
      for (const r of alertsRepo.activeRules(tenantId).filter((r) => r.type === 'signal_loss')) {
        alertsRepo.setRuleState(r.id, vehicle.id, false);
      }
      fireAlert(tenantId, null, {
        type: 'signal_restored',
        priority: 'low',
        vehicleId: vehicle.id,
        deviceId: device.id,
        tripId,
        lat: pos.lat,
        lng: pos.lng,
        attended: true,
        title: `Señal GPS recuperada en ${vehicle.plate}`,
        description: `El dispositivo ${device.serial} volvió a reportar posición.`,
      });
      publish(tenantId, 'device', {
        id: device.id,
        vehicleId: vehicle.id,
        connection: 'online',
        lastSeenAt: ts,
      });
    }

    const alerts = evaluatePosition(vctx, {
      lat: pos.lat,
      lng: pos.lng,
      speed: pos.speed,
      ignition: pos.ignition,
      battery: pos.battery,
      ts,
      stoppedSince,
      tripId,
    });

    const live: LivePayload = {
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      type: vehicle.type,
      deviceId: device.id,
      driverName: vehicle.driver_name ?? null,
      lat: pos.lat,
      lng: pos.lng,
      speed: pos.speed,
      heading: pos.heading,
      accuracy: pos.accuracy,
      battery: pos.battery,
      ignition: pos.ignition,
      ts,
      stoppedSince,
      connection: 'online',
    };
    publish(tenantId, 'position', live);
    return {
      stored: true as const,
      tenantId,
      vehicleId: vehicle.id,
      tripId,
      alerts: alerts.map((a) => a.id),
      live,
    };
  });
}
