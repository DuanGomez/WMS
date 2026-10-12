import { all, bool, get, id, now, parseJson, run, tx } from '../db';
import { notFound } from '../errors';
import { GeofenceShape, LatLng } from '../geo';

export interface GeofenceDto {
  id: string;
  name: string;
  description: string;
  shape: 'circle' | 'polygon' | 'corridor';
  center: LatLng | null;
  radiusM: number | null;
  coordinates: LatLng[];
  color: string;
  allVehicles: boolean;
  vehicleIds: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** Vehículos actualmente dentro (estado en vivo). */
  vehiclesInside: string[];
}

export interface GeofenceInput {
  name: string;
  description?: string;
  shape: GeofenceDto['shape'];
  center?: LatLng | null;
  radiusM?: number | null;
  coordinates?: LatLng[];
  color?: string;
  vehicleIds?: string[];
  active?: boolean;
}

const map = (r: any): GeofenceDto => {
  const vehicleIds = all<{ vehicle_id: string }>(
    `SELECT vehicle_id FROM geofence_vehicles WHERE geofence_id=@id`,
    { id: r.id },
  ).map((x) => x.vehicle_id);
  const inside = all<{ vehicle_id: string }>(
    `SELECT vehicle_id FROM geofence_state WHERE geofence_id=@id AND inside=1`,
    {
      id: r.id,
    },
  ).map((x) => x.vehicle_id);
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    shape: r.shape,
    center: r.center_lat != null ? [r.center_lat, r.center_lng] : null,
    radiusM: r.radius_m,
    coordinates: parseJson(r.coordinates, []),
    color: r.color,
    allVehicles: bool(r.all_vehicles),
    vehicleIds,
    active: bool(r.active),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    vehiclesInside: inside,
  };
};

export const toShape = (
  g: Pick<GeofenceDto, 'shape' | 'center' | 'radiusM' | 'coordinates'>,
): GeofenceShape => ({
  shape: g.shape,
  center: g.center,
  radiusM: g.radiusM,
  coordinates: g.coordinates,
});

export const geofencesRepo = {
  list(tenantId: string, opts: { onlyActive?: boolean } = {}): GeofenceDto[] {
    return all(
      `SELECT * FROM geofences WHERE company_id=@cid AND deleted_at IS NULL AND (@only = 0 OR active = 1) ORDER BY name`,
      { cid: tenantId, only: opts.onlyActive ? 1 : 0 },
    ).map(map);
  },

  get(tenantId: string, geofenceId: string): GeofenceDto {
    const r = get(`SELECT * FROM geofences WHERE id=@id AND company_id=@cid AND deleted_at IS NULL`, {
      id: geofenceId,
      cid: tenantId,
    });
    if (!r) throw notFound('Geocerca');
    return map(r);
  },

  /** Geocercas activas que aplican a un vehículo (todas o las asociadas explícitamente). */
  forVehicle(tenantId: string, vehicleId: string): GeofenceDto[] {
    return all(
      `SELECT g.* FROM geofences g WHERE g.company_id=@cid AND g.deleted_at IS NULL AND g.active=1
         AND (g.all_vehicles=1 OR EXISTS (SELECT 1 FROM geofence_vehicles gv WHERE gv.geofence_id=g.id AND gv.vehicle_id=@vid))`,
      { cid: tenantId, vid: vehicleId },
    ).map(map);
  },

  validVehicleIds(tenantId: string, ids: string[]): string[] {
    if (!ids.length) return [];
    const ok = new Set(
      all<{ id: string }>(`SELECT id FROM vehicles WHERE company_id=@cid AND retired_at IS NULL`, {
        cid: tenantId,
      }).map((v) => v.id),
    );
    const bad = ids.filter((x) => !ok.has(x));
    if (bad.length) throw notFound('Vehículo asociado');
    return ids;
  },

  create(tenantId: string, input: GeofenceInput): GeofenceDto {
    const gid = id();
    const ts = now();
    const vehicleIds = this.validVehicleIds(tenantId, input.vehicleIds ?? []);
    tx(() => {
      run(
        `INSERT INTO geofences (id, company_id, name, description, shape, center_lat, center_lng, radius_m, coordinates, color, all_vehicles, active, created_at, updated_at)
         VALUES (@id,@cid,@name,@desc,@shape,@clat,@clng,@r,@coords,@color,@all,@active,@ts,@ts)`,
        {
          id: gid,
          cid: tenantId,
          name: input.name,
          desc: input.description ?? '',
          shape: input.shape,
          clat: input.center?.[0] ?? null,
          clng: input.center?.[1] ?? null,
          r: input.radiusM ?? null,
          coords: JSON.stringify(input.coordinates ?? []),
          color: input.color ?? '#007AFF',
          all: vehicleIds.length === 0,
          active: input.active ?? true,
          ts,
        },
      );
      for (const v of vehicleIds)
        run(`INSERT INTO geofence_vehicles (geofence_id, vehicle_id) VALUES (@g,@v)`, { g: gid, v });
    });
    return this.get(tenantId, gid);
  },

  update(tenantId: string, geofenceId: string, data: Partial<GeofenceInput>): GeofenceDto {
    const cur = this.get(tenantId, geofenceId);
    const next = { ...cur, ...data };
    const shapeChanged =
      data.shape !== undefined ||
      data.center !== undefined ||
      data.coordinates !== undefined ||
      data.radiusM !== undefined;
    tx(() => {
      run(
        `UPDATE geofences SET name=@name, description=@desc, shape=@shape, center_lat=@clat, center_lng=@clng, radius_m=@r,
           coordinates=@coords, color=@color, active=@active, updated_at=@ts WHERE id=@id AND company_id=@cid`,
        {
          name: next.name,
          desc: next.description,
          shape: next.shape,
          clat: next.center?.[0] ?? null,
          clng: next.center?.[1] ?? null,
          r: next.radiusM ?? null,
          coords: JSON.stringify(next.coordinates ?? []),
          color: next.color,
          active: next.active,
          ts: now(),
          id: geofenceId,
          cid: tenantId,
        },
      );
      if (data.vehicleIds) {
        const ids = this.validVehicleIds(tenantId, data.vehicleIds);
        run(`DELETE FROM geofence_vehicles WHERE geofence_id=@g`, { g: geofenceId });
        for (const v of ids)
          run(`INSERT INTO geofence_vehicles (geofence_id, vehicle_id) VALUES (@g,@v)`, { g: geofenceId, v });
        run(`UPDATE geofences SET all_vehicles=@all WHERE id=@g`, { all: ids.length === 0, g: geofenceId });
      }
      // Si cambió la forma, el estado dentro/fuera se recalcula con la siguiente posición.
      if (shapeChanged) run(`DELETE FROM geofence_state WHERE geofence_id=@g`, { g: geofenceId });
    });
    return this.get(tenantId, geofenceId);
  },

  /** RF8: borrado lógico. */
  remove(tenantId: string, geofenceId: string) {
    this.get(tenantId, geofenceId);
    tx(() => {
      run(`UPDATE geofences SET deleted_at=@ts, active=0 WHERE id=@id AND company_id=@cid`, {
        ts: now(),
        id: geofenceId,
        cid: tenantId,
      });
      run(`DELETE FROM geofence_state WHERE geofence_id=@g`, { g: geofenceId });
    });
  },

  getState: (geofenceId: string, vehicleId: string) =>
    get<{ inside: number }>(`SELECT inside FROM geofence_state WHERE geofence_id=@g AND vehicle_id=@v`, {
      g: geofenceId,
      v: vehicleId,
    }),

  setState: (geofenceId: string, vehicleId: string, inside: boolean) =>
    run(
      `INSERT INTO geofence_state (geofence_id, vehicle_id, inside, changed_at) VALUES (@g,@v,@i,@ts)
       ON CONFLICT(geofence_id, vehicle_id) DO UPDATE SET inside=excluded.inside, changed_at=excluded.changed_at`,
      { g: geofenceId, v: vehicleId, i: inside, ts: now() },
    ),
};
