import { publish } from './bus';
import { all, get, now, run } from './db';
import { isInside, LatLng } from './geo';
import { ALERT_TYPE_LABELS, AlertDto, AlertType, alertsRepo, Priority, RuleDto } from './repositories/alerts';
import { GeofenceDto, geofencesRepo, toShape } from './repositories/geofences';

/**
 * Motor de alertas (RG4, RE3, RE4, RE5).
 * - evaluatePosition(): se ejecuta por cada posición recibida en tracking-ingest.
 * - watchdogTick(): lo ejecuta el timer trigger para pérdida de señal y paradas prolongadas.
 * Cada regla mantiene un estado "firing" por vehículo para no repetir alertas mientras la condición persiste.
 */

export interface VehicleCtx {
  id: string;
  plate: string;
  type: string;
  companyId: string;
  deviceId: string;
  driverName?: string | null;
}

export interface PositionCtx {
  lat: number;
  lng: number;
  speed: number;
  ignition: boolean;
  battery: number | null;
  ts: string;
  stoppedSince: string | null;
  tripId: string | null;
}

const fmtSecs = (s: number) => (s >= 120 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);

function appliesTo(rule: RuleDto, vehicleId: string) {
  return rule.vehicleIds.length === 0 || rule.vehicleIds.includes(vehicleId);
}

/** Guarda la alerta, la emite en tiempo real y simula el envío por correo/push (bandeja "Notificaciones enviadas"). */
export function fireAlert(
  tenantId: string,
  rule: Pick<RuleDto, 'id' | 'channels' | 'recipients' | 'name'> | null,
  input: {
    type: AlertType;
    priority: Priority;
    title: string;
    description: string;
    vehicleId?: string | null;
    deviceId?: string | null;
    tripId?: string | null;
    lat?: number | null;
    lng?: number | null;
    attended?: boolean;
  },
): AlertDto {
  const alert = alertsRepo.insert(tenantId, { ...input, ruleId: rule?.id || null });
  publish(tenantId, 'alert', alert);
  const channels = rule?.channels ?? ['inapp'];
  const where =
    alert.lat != null
      ? `\nUbicación: https://www.openstreetmap.org/?mlat=${alert.lat}&mlon=${alert.lng}#map=17/${alert.lat}/${alert.lng}`
      : '';
  const body = `${alert.description}${where}\nFecha: ${new Date(alert.ts).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`;
  if (channels.includes('email')) {
    for (const to of rule?.recipients ?? []) {
      const n = alertsRepo.insertNotification(tenantId, {
        alertId: alert.id,
        channel: 'email',
        recipient: to,
        subject: `[WMS] ${alert.title}`,
        body,
      });
      console.log(JSON.stringify({ level: 'info', msg: 'email simulado', tenantId, to, subject: n.subject }));
      publish(tenantId, 'notification', n);
    }
  }
  if (channels.includes('push')) {
    const admins = all<{ name: string }>(
      `SELECT name FROM users WHERE company_id=@cid AND role IN ('admin','owner','supervisor') AND active=1 AND deleted_at IS NULL`,
      { cid: tenantId },
    );
    for (const u of admins) {
      const n = alertsRepo.insertNotification(tenantId, {
        alertId: alert.id,
        channel: 'push',
        recipient: `${u.name} (app móvil)`,
        subject: alert.title,
        body: alert.description,
      });
      publish(tenantId, 'notification', n);
    }
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'push simulado',
        tenantId,
        recipients: admins.length,
        title: alert.title,
      }),
    );
  }
  return alert;
}

function geofenceTransitions(v: VehicleCtx, p: LatLng): { geofence: GeofenceDto; entered: boolean }[] {
  const out: { geofence: GeofenceDto; entered: boolean }[] = [];
  for (const g of geofencesRepo.forVehicle(v.companyId, v.id)) {
    const inside = isInside(p, toShape(g));
    const prev = geofencesRepo.getState(g.id, v.id);
    if (!prev) {
      geofencesRepo.setState(g.id, v.id, inside);
      continue;
    }
    if (!!prev.inside !== inside) {
      geofencesRepo.setState(g.id, v.id, inside);
      out.push({ geofence: g, entered: inside });
    }
  }
  return out;
}

/** Evalúa todas las reglas activas del tenant para una nueva posición. Devuelve las alertas generadas. */
export function evaluatePosition(v: VehicleCtx, p: PositionCtx): AlertDto[] {
  const tenantId = v.companyId;
  const rules = alertsRepo.activeRules(tenantId).filter((r) => appliesTo(r, v.id));
  const fired: AlertDto[] = [];
  const point: LatLng = [p.lat, p.lng];
  const base = { vehicleId: v.id, deviceId: v.deviceId, tripId: p.tripId, lat: p.lat, lng: p.lng };
  const transitions = geofenceTransitions(v, point);

  for (const rule of rules) {
    const state = alertsRepo.ruleState(rule.id, v.id);
    const firing = !!state?.firing;
    switch (rule.type) {
      case 'geofence_enter':
      case 'geofence_exit': {
        const wantEnter = rule.type === 'geofence_enter';
        for (const t of transitions) {
          if (t.entered !== wantEnter) continue;
          if (rule.geofenceId && rule.geofenceId !== t.geofence.id) continue;
          fired.push(
            fireAlert(tenantId, rule, {
              ...base,
              type: rule.type,
              priority: rule.priority,
              title: `${v.plate} ${wantEnter ? 'entró a' : 'salió de'} «${t.geofence.name}»`,
              description: `El vehículo ${v.plate}${v.driverName ? ` (${v.driverName})` : ''} ${wantEnter ? 'ingresó a' : 'abandonó'} la geocerca «${t.geofence.name}» a ${Math.round(p.speed)} km/h.`,
            }),
          );
        }
        break;
      }
      case 'route_deviation': {
        if (!rule.geofenceId) break;
        const g = geofencesRepo.forVehicle(tenantId, v.id).find((x) => x.id === rule.geofenceId);
        if (!g) break;
        const inside = isInside(point, toShape(g));
        if (!inside && !firing) {
          alertsRepo.setRuleState(rule.id, v.id, true, true);
          fired.push(
            fireAlert(tenantId, rule, {
              ...base,
              type: 'route_deviation',
              priority: rule.priority,
              title: `${v.plate} se desvió de la ruta autorizada`,
              description: `El vehículo ${v.plate} salió del corredor «${g.name}». Verifica con el conductor${v.driverName ? ` ${v.driverName}` : ''}.`,
            }),
          );
        } else if (inside && firing) {
          alertsRepo.setRuleState(rule.id, v.id, false);
        }
        break;
      }
      case 'prolonged_stop': {
        const threshold = rule.threshold ?? 600;
        const stoppedFor = p.stoppedSince ? (Date.parse(p.ts) - Date.parse(p.stoppedSince)) / 1000 : 0;
        if (p.stoppedSince && stoppedFor >= threshold && !firing) {
          alertsRepo.setRuleState(rule.id, v.id, true, true);
          fired.push(
            fireAlert(tenantId, rule, {
              ...base,
              type: 'prolonged_stop',
              priority: rule.priority,
              title: `${v.plate} lleva ${fmtSecs(stoppedFor)} detenido`,
              description: `Parada prolongada: el vehículo ${v.plate} está detenido desde hace ${fmtSecs(stoppedFor)} (umbral ${fmtSecs(threshold)}).`,
            }),
          );
        } else if (!p.stoppedSince && firing) {
          alertsRepo.setRuleState(rule.id, v.id, false);
        }
        break;
      }
      case 'speeding': {
        const limit = rule.threshold ?? 60;
        if (p.speed > limit && !firing) {
          alertsRepo.setRuleState(rule.id, v.id, true, true);
          fired.push(
            fireAlert(tenantId, rule, {
              ...base,
              type: 'speeding',
              priority: rule.priority,
              title: `${v.plate} a ${Math.round(p.speed)} km/h`,
              description: `Exceso de velocidad: ${Math.round(p.speed)} km/h (límite ${limit} km/h).`,
            }),
          );
        } else if (p.speed < limit - 5 && firing) {
          alertsRepo.setRuleState(rule.id, v.id, false);
        }
        break;
      }
      case 'theft': {
        const minSpeed = rule.threshold ?? 5;
        const suspicious = !p.ignition && p.speed > minSpeed;
        if (suspicious && !firing) {
          alertsRepo.setRuleState(rule.id, v.id, true, true);
          fired.push(
            fireAlert(tenantId, rule, {
              ...base,
              type: 'theft',
              priority: 'critical',
              title: `¡Posible robo de ${v.plate}!`,
              description: `El vehículo ${v.plate} se mueve a ${Math.round(p.speed)} km/h con el encendido apagado (remolque o arranque no autorizado). Contacta al conductor y a la Policía (123).`,
            }),
          );
        } else if (!suspicious && firing && p.ignition) {
          alertsRepo.setRuleState(rule.id, v.id, false);
        }
        break;
      }
      case 'low_battery': {
        const min = rule.threshold ?? 20;
        if (p.battery != null && p.battery < min && !firing) {
          alertsRepo.setRuleState(rule.id, v.id, true, true);
          fired.push(
            fireAlert(tenantId, rule, {
              ...base,
              type: 'low_battery',
              priority: rule.priority,
              title: `Batería del GPS de ${v.plate} al ${p.battery}%`,
              description: `La batería del dispositivo GPS está por debajo del ${min}%. Revisa la alimentación del equipo.`,
            }),
          );
        } else if (p.battery != null && p.battery > min + 5 && firing) {
          alertsRepo.setRuleState(rule.id, v.id, false);
        }
        break;
      }
      case 'signal_loss':
        // Al recibir datos la señal está presente: se rearma la regla (el watchdog la dispara).
        if (firing) alertsRepo.setRuleState(rule.id, v.id, false);
        break;
    }
  }
  return fired;
}

/** Umbral efectivo de pérdida de señal (s) por tenant: el menor de sus reglas activas, o 120 s por defecto. */
function signalThreshold(tenantId: string): number {
  const r = get<{ t: number | null }>(
    `SELECT MIN(threshold) t FROM alert_rules WHERE company_id=@cid AND type='signal_loss' AND active=1 AND deleted_at IS NULL`,
    { cid: tenantId },
  );
  return r?.t ?? 120;
}

/** Tick del watchdog: detecta dispositivos silenciosos (RE5), paradas prolongadas (RE4) y cierra recorridos inactivos. */
export function watchdogTick(): { offline: number; alerts: number } {
  let offline = 0;
  let alerts = 0;
  const t = Date.now();
  const devices = all<any>(
    `SELECT d.*, v.id AS vehicle_id, v.plate, l.lat, l.lng, u.name AS driver_name
     FROM devices d LEFT JOIN vehicles v ON v.device_id = d.id AND v.retired_at IS NULL
     LEFT JOIN vehicle_live l ON l.vehicle_id = v.id LEFT JOIN users u ON u.id = v.driver_id
     WHERE d.status IN ('active','faulty') AND d.connection = 'online' AND d.last_seen_at IS NOT NULL`,
  );
  const thresholds = new Map<string, number>();
  for (const d of devices) {
    if (!thresholds.has(d.company_id)) thresholds.set(d.company_id, signalThreshold(d.company_id));
    const silentFor = (t - Date.parse(d.last_seen_at)) / 1000;
    if (silentFor < thresholds.get(d.company_id)!) continue;
    run(`UPDATE devices SET connection='offline', updated_at=@ts WHERE id=@id`, { id: d.id, ts: now() });
    offline++;
    publish(d.company_id, 'device', {
      id: d.id,
      vehicleId: d.vehicle_id,
      connection: 'offline',
      lastSeenAt: d.last_seen_at,
    });
    if (!d.vehicle_id) continue;
    const rules = alertsRepo
      .activeRules(d.company_id)
      .filter(
        (r) => r.type === 'signal_loss' && appliesTo(r, d.vehicle_id) && silentFor >= (r.threshold ?? 120),
      );
    for (const rule of rules) {
      if (alertsRepo.ruleState(rule.id, d.vehicle_id)?.firing) continue;
      alertsRepo.setRuleState(rule.id, d.vehicle_id, true, true);
      fireAlert(d.company_id, rule, {
        type: 'signal_loss',
        priority: rule.priority,
        vehicleId: d.vehicle_id,
        deviceId: d.id,
        lat: d.lat,
        lng: d.lng,
        title: `Sin señal del GPS de ${d.plate}`,
        description: `El dispositivo ${d.serial} (${d.model}) del vehículo ${d.plate} no reporta hace ${fmtSecs(silentFor)}. Posible falla, desconexión o inhibidor de señal.`,
      });
      alerts++;
    }
  }

  // Paradas prolongadas con dispositivo en línea (respaldo del chequeo en ingest)
  const stopped = all<any>(
    `SELECT l.*, v.plate, v.type, v.device_id, u.name AS driver_name,
       (SELECT id FROM trips WHERE vehicle_id = v.id AND status='open' LIMIT 1) AS trip_id
     FROM vehicle_live l JOIN vehicles v ON v.id = l.vehicle_id LEFT JOIN users u ON u.id = v.driver_id
     JOIN devices d ON d.id = v.device_id
     WHERE l.stopped_since IS NOT NULL AND d.connection='online' AND v.retired_at IS NULL`,
  );
  for (const s of stopped) {
    const fired = evaluateStopOnly(
      {
        id: s.vehicle_id,
        plate: s.plate,
        type: s.type,
        companyId: s.company_id,
        deviceId: s.device_id,
        driverName: s.driver_name,
      },
      {
        lat: s.lat,
        lng: s.lng,
        speed: s.speed,
        ignition: !!s.ignition,
        battery: s.battery,
        ts: now(),
        stoppedSince: s.stopped_since,
        tripId: s.trip_id,
      },
    );
    alerts += fired;
  }
  return { offline, alerts };
}

function evaluateStopOnly(v: VehicleCtx, p: PositionCtx): number {
  let n = 0;
  for (const rule of alertsRepo.activeRules(v.companyId)) {
    if (rule.type !== 'prolonged_stop' || !appliesTo(rule, v.id)) continue;
    if (alertsRepo.ruleState(rule.id, v.id)?.firing) continue;
    const threshold = rule.threshold ?? 600;
    const stoppedFor = (Date.parse(p.ts) - Date.parse(p.stoppedSince!)) / 1000;
    if (stoppedFor < threshold) continue;
    alertsRepo.setRuleState(rule.id, v.id, true, true);
    fireAlert(v.companyId, rule, {
      type: 'prolonged_stop',
      priority: rule.priority,
      vehicleId: v.id,
      deviceId: v.deviceId,
      tripId: p.tripId,
      lat: p.lat,
      lng: p.lng,
      title: `${v.plate} lleva ${fmtSecs(stoppedFor)} detenido`,
      description: `Parada prolongada: el vehículo ${v.plate} está detenido desde hace ${fmtSecs(stoppedFor)} (umbral ${fmtSecs(threshold)}).`,
    });
    n++;
  }
  return n;
}

export { ALERT_TYPE_LABELS };
