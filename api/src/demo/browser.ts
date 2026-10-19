/**
 * API de WMS dentro del navegador (demo de GitHub Pages).
 *
 * Pages solo sirve archivos estáticos, así que este módulo empaqueta las MISMAS funciones del backend
 * (registry de defineHttp/defineTimer) sobre SQLite en WebAssembly (sql.js), corre el simulador GPS y el
 * watchdog en la página y guarda la base en IndexedDB. El frontend le entrega las peticiones /api/* a `handle`.
 * Lo construye scripts/build-pages.mjs; en local y en Azure se usa el backend real.
 */
import initSqlJs from 'sql.js';
import { registerStdFonts } from 'pdfkit';
import Helvetica from 'pdfkit/standard-fonts/Helvetica';
import HelveticaBold from 'pdfkit/standard-fonts/HelveticaBold';

const g = globalThis as any;
const DB_KEY = 'wms-demo-db';
const SCHEMA_TAG = 'v2';
const MAX_AGE_MS = 24 * 3600_000; // los datos demo se regeneran a diario para que el historial sea "de esta semana"

export interface DemoResponse {
  status: number;
  headers: Record<string, string>;
  json?: unknown;
  body?: Uint8Array | string;
}

export interface DemoApi {
  handle(method: string, url: string, headers: Record<string, string>, body: unknown): Promise<DemoResponse>;
  reset(): Promise<void>;
  seededAt: number;
}

/* ---------- IndexedDB ---------- */
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('wms-demo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const q = db.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => res(q.result as T);
      q.onerror = () => res(undefined);
    });
  } catch {
    return undefined;
  }
}
async function idbSet(key: string, value: unknown) {
  try {
    const db = await idb();
    await new Promise<void>((res) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(value, key);
      t.oncomplete = () => res();
      t.onerror = () => res();
    });
  } catch {}
}

export async function boot(opts: { wasmUrl: string; routeUrl: string; onStep?: (msg: string) => void }): Promise<DemoApi> {
  const step = opts.onStep ?? (() => {});
  step('Cargando la base de datos…');
  g.process ??= { env: {}, cwd: () => '/', pid: 1, on() {} };
  Object.assign(g.process.env, { DB_PATH: ':memory:', DEMO_MODE: 'true', WMS_LOCAL_ADAPTER: '1' });
  registerStdFonts(Helvetica, HelveticaBold);

  const [SQL, route, saved] = await Promise.all([
    initSqlJs({ locateFile: () => opts.wasmUrl }),
    fetch(opts.routeUrl).then((r) => r.text()),
    idbGet<{ tag: string; at: number; seededAt?: number; bytes: Uint8Array }>(DB_KEY),
  ]);
  g.__WMS_SQL = SQL;
  g.__WMS_ROUTE = route;
  const fresh = !!saved && saved.tag === SCHEMA_TAG && Date.now() - (saved.seededAt ?? saved.at) < MAX_AGE_MS;
  if (fresh) g.__WMS_DB_BYTES = saved!.bytes;

  // Importar la API registra todas las funciones y abre la base (aplica migraciones si hace falta).
  const { registry, execute } = await import('../shared/http');
  await import('../index');
  let seededAt = fresh ? (saved!.seededAt ?? saved!.at) : Date.now();
  if (!fresh) {
    step('Creando los datos de la demo…');
    const { seed } = await import('../../../scripts/seed');
    await seed({ quiet: true });
    seededAt = Date.now();
  }

  /* ---------- Enrutador: mismas rutas que Azure Functions ---------- */
  const routes = [...registry.http]
    .sort((a, b) => (a.route.replace(/\{\w+\}/g, '￿') < b.route.replace(/\{\w+\}/g, '￿') ? -1 : 1))
    .map((def) => {
      const names: string[] = [];
      const re = new RegExp(
        '^/api/' +
          def.route.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_m, name: string) => {
            names.push(name);
            return '([^/]+)';
          }) +
          '$',
      );
      return { def, re, names };
    });

  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  /** Las acciones del usuario (crear, editar, ubicación del conductor…) se guardan casi de inmediato. */
  const schedulePersist = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => persist(), 600);
  };

  async function handle(method: string, url: string, headers: Record<string, string>, body: unknown): Promise<DemoResponse> {
    const u = new URL(url, 'http://demo.local');
    const m = method.toUpperCase();
    if (m !== 'GET' && !/\/(tracking\/ingest|simulator\/heartbeat)$/.test(u.pathname)) schedulePersist();
    for (const r of routes) {
      if (!r.def.methods.includes(m)) continue;
      const hit = r.re.exec(u.pathname);
      if (!hit) continue;
      const params: Record<string, string> = {};
      r.names.forEach((n, i) => (params[n] = decodeURIComponent(hit[i + 1])));
      const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
      const out = await execute(r.def, {
        method: m,
        path: u.pathname,
        params,
        query: u.searchParams,
        headers: { get: (n: string) => h[n.toLowerCase()] ?? null },
        body: body ?? {},
        ip: 'navegador',
      });
      return { status: out.status, headers: out.headers, json: out.json, body: out.body };
    }
    if (u.pathname === '/api/health') return { status: 200, headers: {}, json: { status: 'ok', runtime: 'browser-demo' } };
    return { status: 404, headers: {}, json: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } };
  }

  /* ---------- Simulador GPS y watchdog en la página ---------- */
  const { createSimulator } = await import('../functions/gps-simulator/loop');
  const call = async (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const r = await handle(init.method ?? 'GET', `/api${path}`, init.headers ?? {}, init.body ? JSON.parse(init.body) : {});
    if (r.status >= 400 && r.status !== 202) {
      throw Object.assign(new Error(`${r.status} ${(r.json as any)?.message ?? ''}`), { status: r.status });
    }
    return r.json ?? null;
  };
  const quiet = () => {};
  const sim = createSimulator({ call, target: 'el navegador', log: quiet, warn: quiet });
  let ticking = false;
  setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      await sim.tick();
    } finally {
      ticking = false;
    }
  }, 1000);
  for (const t of registry.timer) setInterval(() => Promise.resolve(t.handler()).catch(() => {}), t.intervalMs);

  /* ---------- Persistencia en IndexedDB ---------- */
  function persist() {
    const db = g.__WMS_DB;
    if (db) idbSet(DB_KEY, { tag: SCHEMA_TAG, at: Date.now(), seededAt, bytes: db.export() });
  }
  if (!fresh) persist();
  setInterval(persist, 30_000);
  addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && persist());

  return {
    handle,
    seededAt,
    async reset() {
      await idbSet(DB_KEY, null);
      location.reload();
    },
  };
}
