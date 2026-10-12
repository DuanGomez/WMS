import { all, bool, get, id, now, parseJson, run } from '../db';
import { notFound } from '../errors';

export type AlertType =
  | 'geofence_enter'
  | 'geofence_exit'
  | 'prolonged_stop'
  | 'signal_loss'
  | 'route_deviation'
  | 'speeding'
  | 'theft'
  | 'low_battery'
  | 'emergency'
  | 'signal_restored';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type Channel = 'inapp' | 'email' | 'push';

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  geofence_enter: 'Entrada a geocerca',
  geofence_exit: 'Salida de geocerca',
  prolonged_stop: 'Parada prolongada',
  signal_loss: 'Pérdida de señal GPS',
  route_deviation: 'Desvío de ruta',
  speeding: 'Exceso de velocidad',
  theft: 'Posible robo',
  low_battery: 'Batería baja del GPS',
  emergency: 'Emergencia del conductor',
  signal_restored: 'Señal GPS recuperada',
};

export interface RuleDto {
  id: string;
  name: string;
  type: Exclude<AlertType, 'emergency' | 'signal_restored'>;
  typeLabel: string;
  threshold: number | null;
  geofenceId: string | null;
  geofenceName: string | null;
  vehicleIds: string[];
  recipients: string[];
  channels: Channel[];
  priority: Priority;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RuleInput {
  name: string;
  type: RuleDto['type'];
  threshold?: number | null;
  geofenceId?: string | null;
  vehicleIds?: string[];
  recipients?: string[];
  channels?: Channel[];
  priority?: Priority;
  active?: boolean;
}

const mapRule = (r: any): RuleDto => ({
  id: r.id,
  name: r.name,
  type: r.type,
  typeLabel: ALERT_TYPE_LABELS[r.type as AlertType],
  threshold: r.threshold,
  geofenceId: r.geofence_id,
  geofenceName: r.geofence_name ?? null,
  vehicleIds: parseJson(r.vehicle_ids, []),
  recipients: parseJson(r.recipients, []),
  channels: parseJson(r.channels, ['inapp']),
  priority: r.priority,
  active: bool(r.active),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const RULE_SQL = `SELECT r.*, g.name AS geofence_name FROM alert_rules r LEFT JOIN geofences g ON g.id = r.geofence_id
  WHERE r.company_id=@cid AND r.deleted_at IS NULL`;

export interface AlertDto {
  id: string;
  ruleId: string | null;
  vehicleId: string | null;
  vehiclePlate: string | null;
  deviceId: string | null;
  type: AlertType;
  typeLabel: string;
  priority: Priority;
  title: string;
  description: string;
  lat: number | null;
  lng: number | null;
  ts: string;
  attended: boolean;
  attendedBy: string | null;
  attendedAt: string | null;
}

export const mapAlert = (r: any): AlertDto => ({
  id: r.id,
  ruleId: r.rule_id,
  vehicleId: r.vehicle_id,
  vehiclePlate: r.plate ?? null,
  deviceId: r.device_id,
  type: r.type,
  typeLabel: ALERT_TYPE_LABELS[r.type as AlertType] ?? r.type,
  priority: r.priority,
  title: r.title,
  description: r.description,
  lat: r.lat,
  lng: r.lng,
  ts: r.ts,
  attended: bool(r.attended),
  attendedBy: r.attended_by_name ?? r.attended_by ?? null,
  attendedAt: r.attended_at,
});

const ALERT_SQL = `SELECT a.*, v.plate, u.name AS attended_by_name FROM alerts a
  LEFT JOIN vehicles v ON v.id = a.vehicle_id LEFT JOIN users u ON u.id = a.attended_by WHERE a.company_id=@cid`;

export interface AlertFilter {
  type?: string;
  vehicleId?: string;
  attended?: boolean;
  priority?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export const alertsRepo = {
  /* Reglas (RF15, RF17, RF18) */
  listRules: (tenantId: string): RuleDto[] =>
    all(`${RULE_SQL} ORDER BY r.active DESC, r.name`, { cid: tenantId }).map(mapRule),

  activeRules: (tenantId: string): RuleDto[] =>
    all(`${RULE_SQL} AND r.active=1`, { cid: tenantId }).map(mapRule),

  getRule(tenantId: string, ruleId: string): RuleDto {
    const r = get(`${RULE_SQL} AND r.id=@id`, { cid: tenantId, id: ruleId });
    if (!r) throw notFound('Regla de alerta');
    return mapRule(r);
  },

  checkRefs(tenantId: string, input: Partial<RuleInput>) {
    if (input.geofenceId) {
      if (
        !get(`SELECT id FROM geofences WHERE id=@id AND company_id=@cid AND deleted_at IS NULL`, {
          id: input.geofenceId,
          cid: tenantId,
        })
      ) {
        throw notFound('Geocerca');
      }
    }
    for (const v of input.vehicleIds ?? []) {
      if (!get(`SELECT id FROM vehicles WHERE id=@id AND company_id=@cid`, { id: v, cid: tenantId }))
        throw notFound('Vehículo');
    }
  },

  createRule(tenantId: string, input: RuleInput): RuleDto {
    this.checkRefs(tenantId, input);
    const rid = id();
    const ts = now();
    run(
      `INSERT INTO alert_rules (id, company_id, name, type, threshold, geofence_id, vehicle_ids, recipients, channels, priority, active, created_at, updated_at)
       VALUES (@id,@cid,@name,@type,@threshold,@geofence,@vehicles,@recipients,@channels,@priority,@active,@ts,@ts)`,
      {
        id: rid,
        cid: tenantId,
        name: input.name,
        type: input.type,
        threshold: input.threshold ?? null,
        geofence: input.geofenceId ?? null,
        vehicles: JSON.stringify(input.vehicleIds ?? []),
        recipients: JSON.stringify(input.recipients ?? []),
        channels: JSON.stringify(input.channels ?? ['inapp']),
        priority: input.priority ?? 'medium',
        active: input.active ?? true,
        ts,
      },
    );
    return this.getRule(tenantId, rid);
  },

  updateRule(tenantId: string, ruleId: string, data: Partial<RuleInput>): RuleDto {
    const cur = this.getRule(tenantId, ruleId);
    this.checkRefs(tenantId, data);
    const next = { ...cur, ...data };
    run(
      `UPDATE alert_rules SET name=@name, type=@type, threshold=@threshold, geofence_id=@geofence, vehicle_ids=@vehicles,
         recipients=@recipients, channels=@channels, priority=@priority, active=@active, updated_at=@ts WHERE id=@id AND company_id=@cid`,
      {
        name: next.name,
        type: next.type,
        threshold: next.threshold ?? null,
        geofence: next.geofenceId ?? null,
        vehicles: JSON.stringify(next.vehicleIds ?? []),
        recipients: JSON.stringify(next.recipients ?? []),
        channels: JSON.stringify(next.channels ?? ['inapp']),
        priority: next.priority,
        active: next.active,
        ts: now(),
        id: ruleId,
        cid: tenantId,
      },
    );
    run(`DELETE FROM rule_state WHERE rule_id=@id`, { id: ruleId });
    return this.getRule(tenantId, ruleId);
  },

  removeRule(tenantId: string, ruleId: string) {
    this.getRule(tenantId, ruleId);
    run(`UPDATE alert_rules SET deleted_at=@ts, active=0 WHERE id=@id AND company_id=@cid`, {
      ts: now(),
      id: ruleId,
      cid: tenantId,
    });
    run(`DELETE FROM rule_state WHERE rule_id=@id`, { id: ruleId });
  },

  /* Estado por regla y vehículo (evita alertas repetidas mientras la condición persiste) */
  ruleState: (ruleId: string, vehicleId: string) =>
    get<{ firing: number; last_fired_at: string | null }>(
      `SELECT * FROM rule_state WHERE rule_id=@r AND vehicle_id=@v`,
      {
        r: ruleId,
        v: vehicleId,
      },
    ),

  setRuleState: (ruleId: string, vehicleId: string, firing: boolean, fired = false) =>
    run(
      `INSERT INTO rule_state (rule_id, vehicle_id, firing, last_fired_at) VALUES (@r,@v,@f,@t)
       ON CONFLICT(rule_id, vehicle_id) DO UPDATE SET firing=excluded.firing,
         last_fired_at=CASE WHEN @fired = 1 THEN excluded.last_fired_at ELSE rule_state.last_fired_at END`,
      { r: ruleId, v: vehicleId, f: firing, t: fired ? now() : null, fired: fired ? 1 : 0 },
    ),

  /* Historial (RF16) */
  list(tenantId: string, f: AlertFilter = {}): { items: AlertDto[]; total: number; open: number } {
    const where = `
      AND (@type IS NULL OR a.type = @type)
      AND (@vehicle IS NULL OR a.vehicle_id = @vehicle)
      AND (@attended IS NULL OR a.attended = @attended)
      AND (@priority IS NULL OR a.priority = @priority)
      AND (@from IS NULL OR a.ts >= @from)
      AND (@to IS NULL OR a.ts <= @to)`;
    const params = {
      cid: tenantId,
      type: f.type ?? null,
      vehicle: f.vehicleId ?? null,
      attended: f.attended === undefined ? null : f.attended ? 1 : 0,
      priority: f.priority ?? null,
      from: f.from ?? null,
      to: f.to ?? null,
      limit: f.limit ?? 50,
      offset: f.offset ?? 0,
    };
    const items = all(`${ALERT_SQL} ${where} ORDER BY a.ts DESC LIMIT @limit OFFSET @offset`, params).map(
      mapAlert,
    );
    const total = get<{ n: number }>(
      `SELECT COUNT(*) n FROM alerts a WHERE a.company_id=@cid ${where}`,
      params,
    )!.n;
    const open = get<{ n: number }>(`SELECT COUNT(*) n FROM alerts WHERE company_id=@cid AND attended=0`, {
      cid: tenantId,
    })!.n;
    return { items, total, open };
  },

  get(tenantId: string, alertId: string): AlertDto {
    const r = get(`${ALERT_SQL} AND a.id=@id`, { cid: tenantId, id: alertId });
    if (!r) throw notFound('Alerta');
    return mapAlert(r);
  },

  insert(
    tenantId: string,
    a: {
      ruleId?: string | null;
      vehicleId?: string | null;
      deviceId?: string | null;
      tripId?: string | null;
      type: AlertType;
      priority: Priority;
      title: string;
      description: string;
      lat?: number | null;
      lng?: number | null;
      ts?: string;
      attended?: boolean;
    },
  ): AlertDto {
    const aid = id();
    run(
      `INSERT INTO alerts (id, company_id, rule_id, vehicle_id, device_id, trip_id, type, priority, title, description, lat, lng, ts, attended, attended_at)
       VALUES (@id,@cid,@rule,@vehicle,@device,@trip,@type,@priority,@title,@desc,@lat,@lng,@ts,@attended,@attendedAt)`,
      {
        id: aid,
        cid: tenantId,
        rule: a.ruleId ?? null,
        vehicle: a.vehicleId ?? null,
        device: a.deviceId ?? null,
        trip: a.tripId ?? null,
        type: a.type,
        priority: a.priority,
        title: a.title,
        desc: a.description,
        lat: a.lat ?? null,
        lng: a.lng ?? null,
        ts: a.ts ?? now(),
        attended: a.attended ?? false,
        attendedAt: a.attended ? (a.ts ?? now()) : null,
      },
    );
    return this.get(tenantId, aid);
  },

  attend(tenantId: string, alertId: string, userId: string): AlertDto {
    this.get(tenantId, alertId);
    run(`UPDATE alerts SET attended=1, attended_by=@u, attended_at=@ts WHERE id=@id AND company_id=@cid`, {
      u: userId,
      ts: now(),
      id: alertId,
      cid: tenantId,
    });
    return this.get(tenantId, alertId);
  },

  attendAll(tenantId: string, userId: string): number {
    return run(
      `UPDATE alerts SET attended=1, attended_by=@u, attended_at=@ts WHERE company_id=@cid AND attended=0`,
      {
        u: userId,
        ts: now(),
        cid: tenantId,
      },
    ).changes;
  },

  /* Bandeja de notificaciones enviadas (correo/push simulados) */
  insertNotification(
    tenantId: string,
    n: { alertId?: string | null; channel: Channel; recipient: string; subject: string; body: string },
  ) {
    const nid = id();
    run(
      `INSERT INTO notifications (id, company_id, alert_id, channel, recipient, subject, body, status, created_at)
       VALUES (@id,@cid,@alert,@channel,@recipient,@subject,@body,'sent',@ts)`,
      {
        id: nid,
        cid: tenantId,
        alert: n.alertId ?? null,
        channel: n.channel,
        recipient: n.recipient,
        subject: n.subject,
        body: n.body,
        ts: now(),
      },
    );
    return { id: nid, ...n, status: 'sent', createdAt: now() };
  },

  notifications(tenantId: string, limit = 100) {
    return all<any>(
      `SELECT * FROM notifications WHERE company_id=@cid ORDER BY created_at DESC LIMIT @limit`,
      {
        cid: tenantId,
        limit,
      },
    ).map((r) => ({
      id: r.id,
      alertId: r.alert_id,
      channel: r.channel,
      recipient: r.recipient,
      subject: r.subject,
      body: r.body,
      status: r.status,
      createdAt: r.created_at,
    }));
  },
};
