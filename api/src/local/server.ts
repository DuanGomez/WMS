/**
 * Adaptador local ligero: carga las MISMAS funciones definidas para Azure Functions y las expone con Express
 * en http://localhost:7071/api — para levantar el proyecto sin instalar Azure Functions Core Tools.
 */
process.env.WMS_LOCAL_ADAPTER = '1';
import cors from 'cors';
import express, { Request, Response } from 'express';
import { config } from '../shared/config';
import { toErrorBody } from '../shared/errors';
import { ensureSystemData } from '../shared/catalog';
import { closeDb, dialect, get, getDb, run } from '../shared/db';
import { execute, HttpDef, registry, Req, resolveCtx, StreamDef } from '../shared/http';
import { createSimulator } from '../functions/gps-simulator/loop';
import '../index';

/**
 * Orígenes permitidos (CORS_ORIGIN, separados por coma). Acepta comodines de subdominio, p. ej.
 * https://*.wms-lab.pages.dev para las vistas previas de Cloudflare Pages.
 */
export function corsOrigin(list: string[]) {
  const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const rules = list
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .map((o) => (o.includes('*') ? new RegExp('^' + o.split('*').map(escape).join('[a-z0-9-]+') + '$') : o));
  return (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
    cb(null, !origin || rules.some((r) => (typeof r === 'string' ? r === origin : r.test(origin))));
}

const toExpressPath = (route: string) => '/api/' + route.replace(/\{(\w+)\}/g, ':$1');

/** Rutas literales antes que las paramétricas (mismo criterio que el enrutador de Azure Functions). */
const sortKey = (route: string) => route.replace(/\{\w+\}/g, '￿');

function toReq(r: Request): Req {
  const url = new URL(r.originalUrl, 'http://localhost');
  return {
    method: r.method,
    path: url.pathname,
    params: Object.fromEntries(Object.entries(r.params ?? {}).map(([k, v]) => [k, String(v)])),
    query: url.searchParams,
    headers: { get: (n: string) => (r.headers[n.toLowerCase()] as string | undefined) ?? null },
    body: r.body ?? {},
    ip: r.ip ?? 'local',
  };
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // En la nube (Render) la API está detrás de un proxy: la IP real del cliente viene en X-Forwarded-For.
  app.set('trust proxy', config.appEnv === 'local' ? 'loopback' : true);
  app.use(cors({ origin: corsOrigin(config.corsOrigin), credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use((err: any, _req: Request, res: Response, next: (e?: any) => void) => {
    if (err?.type === 'entity.parse.failed')
      return res.status(400).json({ code: 'BAD_JSON', message: 'JSON inválido.' });
    next(err);
  });

  app.get('/api/health', async (_req, res) => {
    // También comprueba la base: Render reinicia el servicio si esto falla.
    const db = await get('SELECT 1 AS ok').then(() => 'ok', (e) => String(e?.message ?? e));
    res.status(db === 'ok' ? 200 : 503).json({
      status: db === 'ok' ? 'ok' : 'degraded',
      env: config.appEnv,
      db: dialect(),
      dbStatus: db,
      runtime: 'express-adapter',
      time: new Date().toISOString(),
    });
  });

  const http = [...registry.http].sort((a, b) => (sortKey(a.route) < sortKey(b.route) ? -1 : 1));
  for (const def of http) mountHttp(app, def);
  for (const def of registry.stream) mountStream(app, def);

  app.use('/api', (_req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'Ruta no encontrada.' }));
  return app;
}

function mountHttp(app: express.Express, def: HttpDef) {
  for (const m of def.methods) {
    const method = m.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    app[method](toExpressPath(def.route), async (r: Request, res: Response) => {
      const out = await execute(def, toReq(r));
      res.status(out.status).set(out.headers);
      if (out.json !== undefined) res.json(out.json);
      else if (out.body !== undefined) res.send(Buffer.from(out.body as any));
      else res.end();
    });
  }
}

function mountStream(app: express.Express, def: StreamDef) {
  app.get(toExpressPath(def.route), async (r: Request, res: Response) => {
    const req = toReq(r);
    let ctx;
    try {
      ctx = await resolveCtx(def.guard, req);
    } catch (e) {
      const { status, body } = toErrorBody(e);
      return res.status(status).json(body);
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    let closed = false;
    let cleanup: (() => void) | null = null;
    r.on('close', () => {
      closed = true;
      cleanup?.();
    });
    const c = await def.handler(req, ctx, (event, data) => {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    });
    if (closed) c();
    else cleanup = c;
  });
}

export function startTimers() {
  return registry.timer.map((t) => {
    // Si una ejecución tarda más que el intervalo (p. ej. base remota lenta), no se encima con la siguiente.
    let busy = false;
    return setInterval(() => {
      if (busy) return;
      busy = true;
      Promise.resolve()
        .then(() => t.handler())
        .catch((e) => console.error(`[timer ${t.name}]`, e))
        .finally(() => (busy = false));
    }, t.intervalMs);
  });
}

/** Laboratorio: si la base está vacía (primer arranque), se carga con los datos demo. */
async function seedLabIfEmpty() {
  if (!config.seedDemoOnEmpty) return;
  const row = await get<{ n: number }>('SELECT COUNT(*) n FROM companies');
  if (Number(row?.n ?? 0) > 0) return;
  console.log('🌱 Laboratorio con base vacía: cargando los datos demo…');
  const { seed } = await import('../seed/demo');
  await seed({ quiet: true });
  console.log('✅ Datos demo listos.');
}

/** Laboratorio en la nube: el simulador GPS corre dentro del servidor y le habla por HTTP local. */
function startInProcessSimulator(port: number) {
  if (!config.simulatorInProcess) return null;
  const base = `http://127.0.0.1:${port}/api`;
  const stepSeconds = Number(process.env.SIMULATOR_STEP_SECONDS ?? 5);
  const sim = createSimulator({
    target: 'el servidor del laboratorio',
    stepSeconds,
    call: async (path, init = {}) => {
      const r = await fetch(base + path, {
        method: init.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
        body: init.body,
      });
      const text = await r.text();
      const json = text ? JSON.parse(text) : null;
      if (!r.ok && r.status !== 202) throw Object.assign(new Error(`${r.status} ${json?.message ?? ''}`), { status: r.status });
      return json;
    },
  });
  let busy = false;
  return setInterval(() => {
    if (busy) return;
    busy = true;
    sim
      .tick()
      .catch((e) => console.error('[simulador]', e))
      .finally(() => (busy = false));
  }, stepSeconds * 1000);
}

/**
 * Retención de posiciones GPS (POSITIONS_RETENTION_DAYS, 0 = conservar todo). En el laboratorio evita que el
 * simulador llene la base gratuita; los recorridos, alertas y reportes se conservan.
 */
function startRetention() {
  const days = Number(process.env.POSITIONS_RETENTION_DAYS ?? (config.appEnv === 'lab' ? 10 : 0));
  if (!days) return null;
  const purge = async () => {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const r = await run('DELETE FROM positions WHERE ts < @cutoff', { cutoff }).catch((e) => {
      console.error('[retención]', e);
      return { changes: 0 };
    });
    if (r.changes) console.log(`🧹 ${r.changes} posiciones de más de ${days} días eliminadas.`);
  };
  void purge();
  return setInterval(() => void purge(), 3_600_000);
}

export async function start() {
  await getDb();
  await seedLabIfEmpty();
  await ensureSystemData(); // planes (y la cuenta de soporte en la nube) en todos los ambientes
  const app = createApp();
  const server = app.listen(config.port, () => {
    const timers = startTimers();
    const sim = startInProcessSimulator(config.port);
    const retention = startRetention();
    console.log(`\n🚚 WMS API · ambiente ${config.appEnv} · http://localhost:${config.port}/api`);
    console.log(
      `   ${registry.http.length} funciones HTTP · ${registry.stream.length} stream SSE · ${registry.timer.length} timer`,
    );
    console.log(`   Base de datos: ${dialect() === 'postgres' ? 'PostgreSQL (DATABASE_URL)' : config.dbPath}`);
    if (sim) console.log('   Simulador GPS: dentro del servidor');
    console.log('');
    const stop = () => {
      console.log('Apagando…');
      for (const t of [...timers, sim, retention]) if (t) clearInterval(t);
      server.close(() => void closeDb().finally(() => process.exit(0)));
      setTimeout(() => process.exit(0), 8000).unref();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  });
  return server;
}

if (require.main === module) {
  start().catch((e) => {
    console.error('❌ No se pudo iniciar la API:', e);
    process.exit(1);
  });
}
