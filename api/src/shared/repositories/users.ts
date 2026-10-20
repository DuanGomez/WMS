import { hashPassword, revokeAllRefreshTokens } from '../auth';
import { all, bool, get, id, now, parseJson, run, tx } from '../db';
import { conflict, notFound } from '../errors';
import { effectivePermissions, PermissionMap, Role, ROLE_LABELS } from '../permissions';

export interface UserDto {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  phone: string;
  active: boolean;
  permissionOverrides: Partial<PermissionMap>;
  permissions: PermissionMap;
  lastLoginAt: string | null;
  createdAt: string;
}

export const mapUser = (r: any): UserDto => {
  const overrides = parseJson<Partial<PermissionMap>>(r.permissions, {});
  return {
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    email: r.email,
    role: r.role,
    roleLabel: ROLE_LABELS[r.role as Role],
    phone: r.phone,
    active: bool(r.active),
    permissionOverrides: overrides,
    permissions: effectivePermissions(r.role, overrides),
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
  };
};

export const usersRepo = {
  findByEmail: (email: string) =>
    get<any>(`SELECT * FROM users WHERE email = @email AND deleted_at IS NULL`, {
      email: email.trim().toLowerCase(),
    }),

  list(tenantId: string, opts: { role?: string; q?: string } = {}): UserDto[] {
    return all(
      `SELECT * FROM users WHERE company_id = @cid AND deleted_at IS NULL
         AND (@role IS NULL OR role = @role)
         AND (@q IS NULL OR name LIKE @q OR email LIKE @q)
       ORDER BY active DESC, name`,
      { cid: tenantId, role: opts.role ?? null, q: opts.q ? `%${opts.q}%` : null },
    ).map(mapUser);
  },

  get(tenantId: string, userId: string): UserDto {
    const r = get(`SELECT * FROM users WHERE id = @id AND company_id = @cid AND deleted_at IS NULL`, {
      id: userId,
      cid: tenantId,
    });
    if (!r) throw notFound('Usuario');
    return mapUser(r);
  },

  async create(
    tenantId: string,
    input: {
      name: string;
      email: string;
      role: Role;
      password: string;
      phone?: string;
      permissions?: Partial<PermissionMap>;
    },
  ): Promise<UserDto> {
    if (this.findByEmail(input.email)) throw conflict('Ya existe un usuario con ese correo.');
    const hash = await hashPassword(input.password);
    const uid = id();
    const ts = now();
    run(
      `INSERT INTO users (id, company_id, name, email, password_hash, role, permissions, phone, created_at, updated_at)
       VALUES (@id,@cid,@name,@email,@hash,@role,@perms,@phone,@ts,@ts)`,
      {
        id: uid,
        cid: tenantId,
        name: input.name,
        email: input.email.toLowerCase(),
        hash,
        role: input.role,
        perms: JSON.stringify(input.permissions ?? {}),
        phone: input.phone ?? '',
        ts,
      },
    );
    return this.get(tenantId, uid);
  },

  update(
    tenantId: string,
    userId: string,
    data: Partial<{ name: string; email: string; role: Role; phone: string; active: boolean }>,
  ) {
    const cur = this.get(tenantId, userId);
    if (data.email && data.email.toLowerCase() !== cur.email) {
      const other = this.findByEmail(data.email);
      if (other && other.id !== userId) throw conflict('Ya existe un usuario con ese correo.');
    }
    const next = { ...cur, ...data };
    run(
      `UPDATE users SET name=@name, email=@email, role=@role, phone=@phone, active=@active, updated_at=@ts
       WHERE id=@id AND company_id=@cid`,
      {
        id: userId,
        cid: tenantId,
        name: next.name,
        email: next.email.toLowerCase(),
        role: next.role,
        phone: next.phone,
        active: next.active,
        ts: now(),
      },
    );
    if (data.active === false) revokeAllRefreshTokens(userId);
    return this.get(tenantId, userId);
  },

  /** RF32: permisos granulares que sobrescriben los del rol. */
  setPermissions(tenantId: string, userId: string, overrides: Partial<PermissionMap>) {
    this.get(tenantId, userId);
    run(`UPDATE users SET permissions=@p, updated_at=@ts WHERE id=@id AND company_id=@cid`, {
      p: JSON.stringify(overrides),
      ts: now(),
      id: userId,
      cid: tenantId,
    });
    return this.get(tenantId, userId);
  },

  /** RF12: borrado lógico (desactiva y libera el vehículo asignado). */
  remove(tenantId: string, userId: string) {
    this.get(tenantId, userId);
    tx(() => {
      run(
        `UPDATE users SET active=0, deleted_at=@ts, email = email || '#deleted-' || @suffix WHERE id=@id AND company_id=@cid`,
        {
          ts: now(),
          suffix: Date.now().toString(36),
          id: userId,
          cid: tenantId,
        },
      );
      run(`UPDATE vehicles SET driver_id=NULL WHERE driver_id=@id AND company_id=@cid`, {
        id: userId,
        cid: tenantId,
      });
      revokeAllRefreshTokens(userId);
    });
  },

  async setPassword(userId: string, plain: string) {
    run(`UPDATE users SET password_hash=@h, must_change_password=0, updated_at=@ts WHERE id=@id`, {
      h: await hashPassword(plain),
      ts: now(),
      id: userId,
    });
  },

  touchLogin(userId: string) {
    run(`UPDATE users SET last_login_at=@ts WHERE id=@id`, { ts: now(), id: userId });
  },
};

/* ---------------- Conductores (RE7) ---------------- */

export interface DriverDto extends UserDto {
  document: string;
  licenseNumber: string;
  licenseCategory: string;
  licenseExpiresAt: string | null;
  status: string;
  shiftActive: boolean;
  vehicle: { id: string; plate: string; type: string } | null;
  openTripId: string | null;
  location: DriverLocationDto | null;
}

const DRIVER_SQL = `
  SELECT u.*, d.document, d.license_number, d.license_category, d.license_expires_at, d.status AS driver_status, d.shift_active,
         v.id AS vehicle_id, v.plate AS vehicle_plate, v.type AS vehicle_type,
         (SELECT t.id FROM trips t WHERE t.vehicle_id = v.id AND t.status='open' ORDER BY t.started_at DESC LIMIT 1) AS open_trip_id,
         l.lat AS loc_lat, l.lng AS loc_lng, l.accuracy AS loc_accuracy, l.speed AS loc_speed, l.heading AS loc_heading,
         l.sharing AS loc_sharing, l.ts AS loc_ts
  FROM users u
  LEFT JOIN driver_profiles d ON d.user_id = u.id
  LEFT JOIN vehicles v ON v.driver_id = u.id AND v.retired_at IS NULL
  LEFT JOIN driver_locations l ON l.user_id = u.id
  WHERE u.company_id = @cid AND u.role = 'driver' AND u.deleted_at IS NULL`;

const mapDriver = (r: any): DriverDto => ({
  ...mapUser(r),
  document: r.document ?? '',
  licenseNumber: r.license_number ?? '',
  licenseCategory: r.license_category ?? '',
  licenseExpiresAt: r.license_expires_at ?? null,
  status: r.driver_status ?? 'disponible',
  shiftActive: bool(r.shift_active),
  vehicle: r.vehicle_id ? { id: r.vehicle_id, plate: r.vehicle_plate, type: r.vehicle_type } : null,
  openTripId: r.open_trip_id ?? null,
  location: r.loc_ts ? mapDriverLocation(r) : null,
});

/** Última ubicación reportada por el celular del conductor. */
export interface DriverLocationDto {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  sharing: boolean;
  ts: string;
}

const mapDriverLocation = (r: any): DriverLocationDto => ({
  lat: r.loc_lat,
  lng: r.loc_lng,
  accuracy: r.loc_accuracy,
  speed: r.loc_speed,
  heading: r.loc_heading,
  sharing: bool(r.loc_sharing),
  ts: r.loc_ts,
});

export interface DriverProfileInput {
  document?: string;
  licenseNumber?: string;
  licenseCategory?: string;
  licenseExpiresAt?: string | null;
  status?: string;
}

export const driversRepo = {
  list: (tenantId: string): DriverDto[] =>
    all(`${DRIVER_SQL} ORDER BY u.name`, { cid: tenantId }).map(mapDriver),

  get(tenantId: string, userId: string): DriverDto {
    const r = get(`${DRIVER_SQL} AND u.id = @id`, { cid: tenantId, id: userId });
    if (!r) throw notFound('Conductor');
    return mapDriver(r);
  },

  upsertProfile(tenantId: string, userId: string, p: DriverProfileInput) {
    const cur = get<any>(`SELECT * FROM driver_profiles WHERE user_id=@id`, { id: userId });
    const next = {
      document: p.document ?? cur?.document ?? '',
      license_number: p.licenseNumber ?? cur?.license_number ?? '',
      license_category: p.licenseCategory ?? cur?.license_category ?? 'A2',
      license_expires_at:
        p.licenseExpiresAt !== undefined ? p.licenseExpiresAt : (cur?.license_expires_at ?? null),
      status: p.status ?? cur?.status ?? 'disponible',
    };
    run(
      `INSERT INTO driver_profiles (user_id, company_id, document, license_number, license_category, license_expires_at, status)
       VALUES (@id,@cid,@document,@license_number,@license_category,@license_expires_at,@status)
       ON CONFLICT(user_id) DO UPDATE SET document=excluded.document, license_number=excluded.license_number,
         license_category=excluded.license_category, license_expires_at=excluded.license_expires_at, status=excluded.status`,
      { id: userId, cid: tenantId, ...next },
    );
  },

  /** Asigna (o libera con vehicleId=null) un vehículo al conductor. Un conductor ↔ un vehículo. */
  assignVehicle(tenantId: string, userId: string, vehicleId: string | null) {
    this.get(tenantId, userId);
    tx(() => {
      run(`UPDATE vehicles SET driver_id=NULL, updated_at=@ts WHERE driver_id=@uid AND company_id=@cid`, {
        uid: userId,
        cid: tenantId,
        ts: now(),
      });
      if (vehicleId) {
        const v = get(`SELECT id FROM vehicles WHERE id=@vid AND company_id=@cid AND retired_at IS NULL`, {
          vid: vehicleId,
          cid: tenantId,
        });
        if (!v) throw notFound('Vehículo');
        run(`UPDATE vehicles SET driver_id=@uid, updated_at=@ts WHERE id=@vid`, {
          uid: userId,
          vid: vehicleId,
          ts: now(),
        });
      }
    });
    return this.get(tenantId, userId);
  },

  setShift(tenantId: string, userId: string, active: boolean) {
    run(`UPDATE driver_profiles SET shift_active=@a, status=@s WHERE user_id=@id AND company_id=@cid`, {
      a: active,
      s: active ? 'en_ruta' : 'disponible',
      id: userId,
      cid: tenantId,
    });
  },

  /** Guarda la ubicación enviada por el celular del conductor (Geolocation API del navegador). */
  saveLocation(
    tenantId: string,
    userId: string,
    p: { lat: number; lng: number; accuracy?: number | null; speed?: number | null; heading?: number | null; ts: string },
  ) {
    run(
      `INSERT INTO driver_locations (user_id, company_id, lat, lng, accuracy, speed, heading, sharing, source, ts)
       VALUES (@uid,@cid,@lat,@lng,@accuracy,@speed,@heading,1,'browser',@ts)
       ON CONFLICT(user_id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, accuracy=excluded.accuracy,
         speed=excluded.speed, heading=excluded.heading, sharing=1, ts=excluded.ts`,
      { uid: userId, cid: tenantId, ...p, accuracy: p.accuracy ?? null, speed: p.speed ?? null, heading: p.heading ?? null },
    );
  },

  /** ts pasa a la hora de la pausa: así el polling (locations con `since`) también entrega el cambio. */
  stopSharing(tenantId: string, userId: string) {
    run(`UPDATE driver_locations SET sharing=0, ts=@ts WHERE user_id=@uid AND company_id=@cid`, {
      uid: userId,
      cid: tenantId,
      ts: now(),
    });
  },

  /** Conductores con ubicación conocida (para el mapa del administrador). */
  locations(tenantId: string, opts: { since?: string; userId?: string } = {}) {
    return all(
      `${DRIVER_SQL} AND l.ts IS NOT NULL AND (@since IS NULL OR l.ts > @since) AND (@only IS NULL OR u.id = @only) ORDER BY u.name`,
      { cid: tenantId, since: opts.since ?? null, only: opts.userId ?? null },
    )
      .map(mapDriver)
      .map(toDriverMarker);
  },
};

/** Forma compacta que viaja por el stream en tiempo real y pinta el marcador del conductor. */
export function toDriverMarker(d: DriverDto) {
  return {
    driverId: d.id,
    name: d.name,
    phone: d.phone,
    status: d.status,
    shiftActive: d.shiftActive,
    vehiclePlate: d.vehicle?.plate ?? null,
    ...d.location!,
  };
}
