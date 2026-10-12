/** Permisos granulares por módulo (RF32): cada rol tiene valores por defecto y cada usuario puede sobrescribirlos. */
export const MODULES = [
  'dashboard',
  'map',
  'vehicles',
  'drivers',
  'devices',
  'geofences',
  'alerts',
  'reports',
  'users',
  'billing',
  'support',
  'simulator',
] as const;
export type Module = (typeof MODULES)[number];
export type Level = 'none' | 'read' | 'write';
export type Role = 'admin' | 'owner' | 'supervisor' | 'driver' | 'support';
export type PermissionMap = Record<Module, Level>;

export const ROLES: Role[] = ['admin', 'owner', 'supervisor', 'driver', 'support'];
export const TENANT_ROLES: Role[] = ['admin', 'owner', 'supervisor', 'driver'];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  owner: 'Responsable de empresa',
  supervisor: 'Supervisor',
  driver: 'Conductor',
  support: 'Agente de soporte',
};

const all = (level: Level): PermissionMap =>
  Object.fromEntries(MODULES.map((m) => [m, level])) as PermissionMap;

export const ROLE_DEFAULTS: Record<Role, PermissionMap> = {
  owner: all('write'),
  admin: { ...all('write'), billing: 'read' },
  supervisor: {
    ...all('read'),
    vehicles: 'write',
    drivers: 'write',
    geofences: 'write',
    alerts: 'write',
    reports: 'write',
    support: 'write',
    users: 'none',
    billing: 'none',
  },
  driver: {
    ...all('none'),
    map: 'read',
    vehicles: 'read',
    alerts: 'read',
    support: 'write',
  },
  support: { ...all('none'), support: 'write' },
};

const rank: Record<Level, number> = { none: 0, read: 1, write: 2 };

export function effectivePermissions(
  role: Role,
  overrides: Partial<PermissionMap> | null | undefined,
): PermissionMap {
  const base = { ...ROLE_DEFAULTS[role] };
  if (overrides) {
    for (const m of MODULES) {
      const v = overrides[m];
      if (v === 'none' || v === 'read' || v === 'write') base[m] = v;
    }
  }
  return base;
}

export function can(perms: PermissionMap, module: Module, level: Level): boolean {
  return rank[perms[module]] >= rank[level];
}
