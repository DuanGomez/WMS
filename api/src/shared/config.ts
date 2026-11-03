import fs from 'node:fs';
import path from 'node:path';

/** Raíz del paquete api (funciona tanto desde src/ con tsx como desde dist/ compilado). */
function findApiRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        if (JSON.parse(fs.readFileSync(pkg, 'utf8')).name === '@wms/api') return dir;
      } catch {}
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export const API_ROOT = findApiRoot();
export const REPO_ROOT = path.resolve(API_ROOT, '..');

/** Carga mínima de .env de la raíz del monorepo (sin dependencias). */
function loadDotEnv() {
  const file = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

function resolveDbPath(): string {
  const raw = process.env.DB_PATH;
  if (!raw) return path.join(API_ROOT, 'data', 'wms.db');
  if (raw === ':memory:' || path.isAbsolute(raw)) return raw;
  // Rutas relativas: primero respecto a la raíz del repo (api/data/...), si no respecto a api/
  return raw.startsWith('api/') || raw.startsWith('api\\')
    ? path.join(REPO_ROOT, raw)
    : path.join(API_ROOT, raw);
}

/**
 * Ambiente de ejecución:
 *  - local:      desarrollo en tu equipo (SQLite, datos demo, simulador en otro proceso).
 *  - lab:        laboratorio en la nube (Postgres, datos demo y simulador GPS dentro del servidor).
 *  - production: producción en la nube (Postgres, base vacía: sin datos demo, sin simulador, sin cuentas demo).
 */
export type AppEnv = 'local' | 'lab' | 'production';
const appEnv: AppEnv = (['lab', 'production'] as const).find((e) => e === process.env.APP_ENV) ?? 'local';

const DEV_JWT = 'wms-dev-secret-cambiar';
const DEV_REFRESH = 'wms-dev-refresh-secret-cambiar';
if (appEnv !== 'local') {
  // En la nube nunca se arranca con las claves de desarrollo (cualquiera podría firmar tokens).
  for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'SIMULATOR_KEY'] as const) {
    const v = process.env[k] ?? '';
    if (v.length < 24 || v === DEV_JWT || v === DEV_REFRESH) {
      throw new Error(`${k} debe estar definida con al menos 24 caracteres en el ambiente ${appEnv}.`);
    }
  }
}

export const config = {
  appEnv,
  port: Number(process.env.PORT ?? 7071),
  jwtSecret: process.env.JWT_SECRET ?? DEV_JWT,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? DEV_REFRESH,
  /** Clave compartida entre el simulador GPS (loop.ts) y sus funciones de control (/simulator/*). */
  simulatorKey: process.env.SIMULATOR_KEY ?? 'wms-simulator-local-key',
  accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7),
  get dbPath() {
    return resolveDbPath();
  },
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:4200').split(','),
  /** Umbrales cortos de alertas y utilidades demo. Nunca en producción. */
  demoMode: appEnv !== 'production' && (process.env.DEMO_MODE ?? 'true') !== 'false',
  /** Laboratorio: si la base está vacía al arrancar, se carga con los datos demo; y el simulador GPS corre en el servidor. */
  seedDemoOnEmpty: appEnv === 'lab',
  simulatorInProcess: appEnv === 'lab' && process.env.SIMULATOR !== 'off',
  timezone: 'America/Bogota',
};
