import { randomToken } from '../auth';
import { all, bool, get, id, now, run, tx } from '../db';
import { conflict, notFound } from '../errors';
import { companiesRepo } from './companies';

/* ---------------- Dispositivos GPS (RF28-RF31) ---------------- */

export interface DeviceDto {
  id: string;
  serial: string;
  model: string;
  status: 'active' | 'inactive' | 'faulty' | 'retired';
  connection: 'online' | 'offline' | 'unknown';
  battery: number | null;
  powered: boolean;
  lastSeenAt: string | null;
  notes: string;
  retiredReason: string | null;
  retiredAt: string | null;
  createdAt: string;
  vehicle: { id: string; plate: string; type: string } | null;
  apiKey?: string;
}

const DEVICE_SQL = `
  SELECT d.*, v.id AS vehicle_id, v.plate AS vehicle_plate, v.type AS vehicle_type
  FROM devices d LEFT JOIN vehicles v ON v.device_id = d.id AND v.retired_at IS NULL
  WHERE d.company_id = @cid`;

const mapDevice = (r: any, withKey = false): DeviceDto => ({
  id: r.id,
  serial: r.serial,
  model: r.model,
  status: r.status,
  connection: r.connection,
  battery: r.battery,
  powered: bool(r.powered),
  lastSeenAt: r.last_seen_at,
  notes: r.notes,
  retiredReason: r.retired_reason,
  retiredAt: r.retired_at,
  createdAt: r.created_at,
  vehicle: r.vehicle_id ? { id: r.vehicle_id, plate: r.vehicle_plate, type: r.vehicle_type } : null,
  ...(withKey ? { apiKey: r.api_key } : {}),
});

export const devicesRepo = {
  list(tenantId: string, opts: { includeRetired?: boolean; status?: string } = {}): DeviceDto[] {
    return all(
      `${DEVICE_SQL} AND (@inc = 1 OR d.status <> 'retired') AND (@status IS NULL OR d.status = @status)
       ORDER BY d.status = 'retired', d.serial`,
      { cid: tenantId, inc: opts.includeRetired ? 1 : 0, status: opts.status ?? null },
    ).map((r) => mapDevice(r));
  },

  get(tenantId: string, deviceId: string, withKey = false): DeviceDto {
    const r = get(`${DEVICE_SQL} AND d.id = @id`, { cid: tenantId, id: deviceId });
    if (!r) throw notFound('Dispositivo GPS');
    return mapDevice(r, withKey);
  },

  /** Busca por API key (autenticación del dispositivo en tracking-ingest). No filtra por tenant: el tenant sale del dispositivo. */
  byApiKey: (key: string) =>
    get<any>(`SELECT * FROM devices WHERE api_key = @k AND status <> 'retired'`, { k: key }),

  create(
    tenantId: string,
    input: { serial: string; model: string; notes?: string; status?: 'active' | 'inactive'; apiKey?: string },
  ) {
    const did = id();
    const ts = now();
    run(
      `INSERT INTO devices (id, company_id, serial, model, api_key, status, notes, created_at, updated_at)
       VALUES (@id,@cid,@serial,@model,@key,@status,@notes,@ts,@ts)`,
      {
        id: did,
        cid: tenantId,
        serial: input.serial,
        model: input.model,
        key: input.apiKey ?? `gps_${randomToken(24)}`,
        status: input.status ?? 'active',
        notes: input.notes ?? '',
        ts,
      },
    );
    return this.get(tenantId, did, true);
  },

  /** RF30: actualizar datos/estado y/o reasignar a otro vehículo (vehicleId null = desasociar). */
  update(
    tenantId: string,
    deviceId: string,
    data: {
      model?: string;
      notes?: string;
      status?: 'active' | 'inactive' | 'faulty';
      vehicleId?: string | null;
    },
  ) {
    const cur = this.get(tenantId, deviceId);
    if (cur.status === 'retired') throw conflict('El dispositivo está dado de baja.');
    tx(() => {
      run(
        `UPDATE devices SET model=@model, notes=@notes, status=@status, updated_at=@ts WHERE id=@id AND company_id=@cid`,
        {
          model: data.model ?? cur.model,
          notes: data.notes ?? cur.notes,
          status: data.status ?? cur.status,
          ts: now(),
          id: deviceId,
          cid: tenantId,
        },
      );
      if (data.vehicleId !== undefined) {
        run(`UPDATE vehicles SET device_id=NULL, updated_at=@ts WHERE device_id=@id AND company_id=@cid`, {
          id: deviceId,
          cid: tenantId,
          ts: now(),
        });
        if (data.vehicleId) {
          const v = get(`SELECT id FROM vehicles WHERE id=@vid AND company_id=@cid AND retired_at IS NULL`, {
            vid: data.vehicleId,
            cid: tenantId,
          });
          if (!v) throw notFound('Vehículo');
          run(`UPDATE vehicles SET device_id=@id, updated_at=@ts WHERE id=@vid`, {
            id: deviceId,
            vid: data.vehicleId,
            ts: now(),
          });
        }
      }
    });
    return this.get(tenantId, deviceId);
  },

  /** RF31: baja definitiva (robado, dañado, fin de vida útil). Se conserva el histórico. */
  retire(tenantId: string, deviceId: string, reason: string) {
    this.get(tenantId, deviceId);
    tx(() => {
      run(`UPDATE vehicles SET device_id=NULL, updated_at=@ts WHERE device_id=@id AND company_id=@cid`, {
        id: deviceId,
        cid: tenantId,
        ts: now(),
      });
      run(
        `UPDATE devices SET status='retired', connection='offline', retired_reason=@reason, retired_at=@ts, updated_at=@ts
         WHERE id=@id AND company_id=@cid`,
        { reason, ts: now(), id: deviceId, cid: tenantId },
      );
    });
  },

  regenerateKey(tenantId: string, deviceId: string) {
    this.get(tenantId, deviceId);
    run(`UPDATE devices SET api_key=@k, updated_at=@ts WHERE id=@id AND company_id=@cid`, {
      k: `gps_${randomToken(24)}`,
      ts: now(),
      id: deviceId,
      cid: tenantId,
    });
    return this.get(tenantId, deviceId, true);
  },
};

/* ---------------- Vehículos (RF1-RF4) ---------------- */

export interface VehicleDto {
  id: string;
  plate: string;
  type: 'moto' | 'carro' | 'camion' | 'furgon';
  brand: string;
  model: string;
  year: number | null;
  color: string;
  status: 'active' | 'maintenance' | 'inactive' | 'retired';
  createdAt: string;
  retiredAt: string | null;
  retiredReason: string | null;
  device: {
    id: string;
    serial: string;
    model: string;
    connection: string;
    battery: number | null;
    status: string;
    lastSeenAt: string | null;
  } | null;
  driver: { id: string; name: string; phone: string } | null;
  live: {
    lat: number;
    lng: number;
    speed: number;
    heading: number;
    accuracy: number;
    battery: number | null;
    ignition: boolean;
    ts: string;
    stoppedSince: string | null;
  } | null;
}

const VEHICLE_SQL = `
  SELECT v.*,
    d.serial AS device_serial, d.model AS device_model, d.connection AS device_connection, d.battery AS device_battery,
    d.status AS device_status, d.last_seen_at AS device_last_seen,
    u.name AS driver_name, u.phone AS driver_phone,
    l.lat, l.lng, l.speed, l.heading, l.accuracy, l.battery AS live_battery, l.ignition, l.ts AS live_ts, l.stopped_since
  FROM vehicles v
  LEFT JOIN devices d ON d.id = v.device_id
  LEFT JOIN users u ON u.id = v.driver_id
  LEFT JOIN vehicle_live l ON l.vehicle_id = v.id
  WHERE v.company_id = @cid`;

export const mapVehicle = (r: any): VehicleDto => ({
  id: r.id,
  plate: r.plate,
  type: r.type,
  brand: r.brand,
  model: r.model,
  year: r.year,
  color: r.color,
  status: r.status,
  createdAt: r.created_at,
  retiredAt: r.retired_at,
  retiredReason: r.retired_reason,
  device: r.device_id
    ? {
        id: r.device_id,
        serial: r.device_serial,
        model: r.device_model,
        connection: r.device_connection,
        battery: r.device_battery,
        status: r.device_status,
        lastSeenAt: r.device_last_seen,
      }
    : null,
  driver: r.driver_id ? { id: r.driver_id, name: r.driver_name, phone: r.driver_phone } : null,
  live:
    r.lat != null
      ? {
          lat: r.lat,
          lng: r.lng,
          speed: r.speed,
          heading: r.heading,
          accuracy: r.accuracy,
          battery: r.live_battery,
          ignition: bool(r.ignition),
          ts: r.live_ts,
          stoppedSince: r.stopped_since,
        }
      : null,
});

export interface VehicleInput {
  plate: string;
  type: VehicleDto['type'];
  brand?: string;
  model?: string;
  year?: number | null;
  color?: string;
  status?: 'active' | 'maintenance' | 'inactive';
  deviceId?: string | null;
  driverId?: string | null;
}

export const vehiclesRepo = {
  list(
    tenantId: string,
    opts: { includeRetired?: boolean; q?: string; type?: string; driverId?: string } = {},
  ): VehicleDto[] {
    return all(
      `${VEHICLE_SQL} AND (@inc = 1 OR v.retired_at IS NULL)
        AND (@q IS NULL OR v.plate LIKE @q OR v.brand LIKE @q OR v.model LIKE @q)
        AND (@type IS NULL OR v.type = @type)
        AND (@driver IS NULL OR v.driver_id = @driver)
       ORDER BY v.retired_at IS NOT NULL, v.plate`,
      {
        cid: tenantId,
        inc: opts.includeRetired ? 1 : 0,
        q: opts.q ? `%${opts.q}%` : null,
        type: opts.type ?? null,
        driver: opts.driverId ?? null,
      },
    ).map(mapVehicle);
  },

  get(tenantId: string, vehicleId: string): VehicleDto {
    const r = get(`${VEHICLE_SQL} AND v.id = @id`, { cid: tenantId, id: vehicleId });
    if (!r) throw notFound('Vehículo');
    return mapVehicle(r);
  },

  byDevice: (deviceId: string) =>
    get<any>(`SELECT * FROM vehicles WHERE device_id = @d AND retired_at IS NULL`, { d: deviceId }),

  checkRefs(tenantId: string, deviceId?: string | null, driverId?: string | null, selfId?: string) {
    if (deviceId) {
      const d = get<any>(`SELECT status FROM devices WHERE id=@id AND company_id=@cid`, {
        id: deviceId,
        cid: tenantId,
      });
      if (!d || d.status === 'retired') throw notFound('Dispositivo GPS');
      const used = get<any>(
        `SELECT plate FROM vehicles WHERE device_id=@id AND retired_at IS NULL AND id <> @self`,
        {
          id: deviceId,
          self: selfId ?? '',
        },
      );
      if (used) throw conflict(`El dispositivo ya está instalado en el vehículo ${used.plate}.`);
    }
    if (driverId) {
      const u = get(
        `SELECT id FROM users WHERE id=@id AND company_id=@cid AND role='driver' AND deleted_at IS NULL`,
        {
          id: driverId,
          cid: tenantId,
        },
      );
      if (!u) throw notFound('Conductor');
    }
  },

  create(tenantId: string, input: VehicleInput): VehicleDto {
    companiesRepo.assertCanAdd(tenantId, 'vehicles');
    const plate = input.plate.toUpperCase().replace(/\s+/g, '');
    if (
      get(`SELECT id FROM vehicles WHERE company_id=@cid AND plate=@plate AND retired_at IS NULL`, {
        cid: tenantId,
        plate,
      })
    ) {
      throw conflict(`Ya existe un vehículo con la placa ${plate}.`);
    }
    this.checkRefs(tenantId, input.deviceId, input.driverId);
    const vid = id();
    const ts = now();
    tx(() => {
      if (input.driverId)
        run(`UPDATE vehicles SET driver_id=NULL WHERE driver_id=@d AND company_id=@cid`, {
          d: input.driverId,
          cid: tenantId,
        });
      run(
        `INSERT INTO vehicles (id, company_id, plate, type, brand, model, year, color, status, device_id, driver_id, created_at, updated_at)
         VALUES (@id,@cid,@plate,@type,@brand,@model,@year,@color,@status,@device,@driver,@ts,@ts)`,
        {
          id: vid,
          cid: tenantId,
          plate,
          type: input.type,
          brand: input.brand ?? '',
          model: input.model ?? '',
          year: input.year ?? null,
          color: input.color ?? '',
          status: input.status ?? 'active',
          device: input.deviceId ?? null,
          driver: input.driverId ?? null,
          ts,
        },
      );
    });
    return this.get(tenantId, vid);
  },

  update(tenantId: string, vehicleId: string, data: Partial<VehicleInput>): VehicleDto {
    const cur = this.get(tenantId, vehicleId);
    if (cur.retiredAt) throw conflict('El vehículo está dado de baja.');
    const plate = data.plate ? data.plate.toUpperCase().replace(/\s+/g, '') : cur.plate;
    if (
      plate !== cur.plate &&
      get(`SELECT id FROM vehicles WHERE company_id=@cid AND plate=@plate AND retired_at IS NULL`, {
        cid: tenantId,
        plate,
      })
    ) {
      throw conflict(`Ya existe un vehículo con la placa ${plate}.`);
    }
    const deviceId = data.deviceId !== undefined ? data.deviceId : (cur.device?.id ?? null);
    const driverId = data.driverId !== undefined ? data.driverId : (cur.driver?.id ?? null);
    this.checkRefs(tenantId, deviceId, driverId, vehicleId);
    tx(() => {
      if (driverId && driverId !== cur.driver?.id) {
        run(`UPDATE vehicles SET driver_id=NULL WHERE driver_id=@d AND company_id=@cid`, {
          d: driverId,
          cid: tenantId,
        });
      }
      run(
        `UPDATE vehicles SET plate=@plate, type=@type, brand=@brand, model=@model, year=@year, color=@color, status=@status,
           device_id=@device, driver_id=@driver, updated_at=@ts WHERE id=@id AND company_id=@cid`,
        {
          plate,
          type: data.type ?? cur.type,
          brand: data.brand ?? cur.brand,
          model: data.model ?? cur.model,
          year: data.year !== undefined ? data.year : cur.year,
          color: data.color ?? cur.color,
          status: data.status ?? cur.status,
          device: deviceId,
          driver: driverId,
          ts: now(),
          id: vehicleId,
          cid: tenantId,
        },
      );
    });
    return this.get(tenantId, vehicleId);
  },

  /** RF4: dar de baja (borrado lógico, libera dispositivo y conductor, conserva el histórico). */
  retire(tenantId: string, vehicleId: string, reason: string) {
    const cur = this.get(tenantId, vehicleId);
    if (cur.retiredAt) throw conflict('El vehículo ya está dado de baja.');
    tx(() => {
      run(
        `UPDATE vehicles SET status='retired', retired_at=@ts, retired_reason=@reason, device_id=NULL, driver_id=NULL, updated_at=@ts
         WHERE id=@id AND company_id=@cid`,
        { ts: now(), reason, id: vehicleId, cid: tenantId },
      );
      run(
        `UPDATE trips SET status='closed', ended_at=COALESCE(ended_at, @ts) WHERE vehicle_id=@id AND status='open'`,
        {
          ts: now(),
          id: vehicleId,
        },
      );
    });
  },
};
