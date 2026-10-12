import { authenticate, AuthUser, requirePermission } from './auth';
import { forbidden, toErrorBody, unauthorized } from './errors';
import { Level, Module } from './permissions';

/**
 * Capa de definición de funciones al estilo Azure Functions v4.
 * Cada función se declara una sola vez con defineHttp/defineStream/defineTimer y:
 *  - si corre dentro del host de Azure Functions (FUNCTIONS_WORKER_RUNTIME definido) se registra con app.http/app.timer;
 *  - en cualquier caso queda en `registry`, que usa el adaptador Express local (src/local/server.ts) y las pruebas.
 */
export interface Req {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: { get(name: string): string | null };
  body: any;
  ip: string;
}

export interface Res {
  status?: number;
  json?: unknown;
  body?: Uint8Array | string;
  headers?: Record<string, string>;
}

export interface Ctx {
  user: AuthUser;
  /** Tenant (empresaId) obligatorio en toda consulta de negocio (RE8, RG10). */
  tenantId: string;
}

export type Guard =
  | 'public'
  | 'authenticated'
  | { module: Module; level: Level; roles?: AuthUser['role'][] }
  | { roles: AuthUser['role'][] };

export interface HttpDef {
  kind: 'http';
  name: string;
  route: string;
  methods: string[];
  guard: Guard;
  handler: (req: Req, ctx: Ctx) => Promise<Res> | Res;
}

export type Send = (event: string, data: unknown) => void;
export interface StreamDef {
  kind: 'stream';
  name: string;
  route: string;
  guard: Guard;
  /** Devuelve una función de limpieza que se llama al cerrar la conexión. */
  handler: (req: Req, ctx: Ctx, send: Send) => () => void;
}

export interface TimerDef {
  kind: 'timer';
  name: string;
  /** NCRONTAB de 6 campos (Azure). */
  schedule: string;
  /** Intervalo equivalente para el adaptador local. */
  intervalMs: number;
  handler: () => Promise<void> | void;
}

export const registry: { http: HttpDef[]; stream: StreamDef[]; timer: TimerDef[] } = {
  http: [],
  stream: [],
  timer: [],
};

const inAzure = () => !!process.env.FUNCTIONS_WORKER_RUNTIME && !process.env.WMS_LOCAL_ADAPTER;

function azure() {
  // Import diferido: el adaptador local nunca necesita cargar el runtime de Azure.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@azure/functions') as typeof import('@azure/functions');
}

/** Resuelve el usuario y valida rol/permiso del guard. */
export function resolveCtx(guard: Guard, req: Req): Ctx {
  if (guard === 'public') return { user: null as unknown as AuthUser, tenantId: '' };
  const header = req.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : req.query.get('access_token');
  if (!token) throw unauthorized();
  const user = authenticate(token);
  if (guard !== 'authenticated') {
    if ('roles' in guard && guard.roles && !guard.roles.includes(user.role)) throw forbidden();
    if ('module' in guard) requirePermission(user, guard.module, guard.level);
  }
  return { user, tenantId: user.companyId };
}

export async function execute(
  def: HttpDef,
  req: Req,
): Promise<{ status: number; headers: Record<string, string>; body?: Uint8Array | string; json?: unknown }> {
  try {
    const ctx = resolveCtx(def.guard, req);
    const res = await def.handler(req, ctx);
    const status = res.status ?? (res.json === undefined && res.body === undefined ? 204 : 200);
    return { status, headers: res.headers ?? {}, body: res.body, json: res.json };
  } catch (e) {
    const { status, body } = toErrorBody(e);
    return { status, headers: {}, json: body };
  }
}

export function defineHttp(def: Omit<HttpDef, 'kind'>) {
  const full: HttpDef = { kind: 'http', ...def };
  registry.http.push(full);
  if (inAzure()) {
    const { app } = azure();
    app.http(def.name, {
      methods: def.methods as any,
      route: def.route,
      authLevel: 'anonymous',
      handler: async (request) => {
        const text = ['GET', 'HEAD', 'DELETE'].includes(request.method) ? '' : await request.text();
        const req: Req = {
          method: request.method,
          path: new URL(request.url).pathname,
          params: { ...request.params },
          query: request.query as unknown as URLSearchParams,
          headers: request.headers,
          body: text ? safeJson(text) : {},
          ip: request.headers.get('x-forwarded-for') ?? 'azure',
        };
        const out = await execute(full, req);
        return out.json !== undefined
          ? { status: out.status, headers: out.headers, jsonBody: out.json }
          : { status: out.status, headers: out.headers, body: out.body as any };
      },
    });
  }
  return full;
}

export function defineStream(def: Omit<StreamDef, 'kind'>) {
  const full: StreamDef = { kind: 'stream', ...def };
  registry.stream.push(full);
  if (inAzure()) {
    const { app } = azure();
    app.setup({ enableHttpStream: true });
    app.http(def.name, {
      methods: ['GET'],
      route: def.route,
      authLevel: 'anonymous',
      handler: async (request) => {
        const req: Req = {
          method: 'GET',
          path: new URL(request.url).pathname,
          params: { ...request.params },
          query: request.query as unknown as URLSearchParams,
          headers: request.headers,
          body: {},
          ip: 'azure',
        };
        let ctx: Ctx;
        try {
          ctx = resolveCtx(def.guard, req);
        } catch (e) {
          const { status, body } = toErrorBody(e);
          return { status, jsonBody: body };
        }
        const encoder = new TextEncoder();
        let cleanup: () => void = () => {};
        const stream = new ReadableStream({
          start(controller) {
            const send: Send = (event, data) =>
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            cleanup = def.handler(req, ctx, send);
          },
          cancel() {
            cleanup();
          },
        });
        return {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
          body: stream as any,
        };
      },
    });
  }
  return full;
}

export function defineTimer(def: Omit<TimerDef, 'kind'>) {
  const full: TimerDef = { kind: 'timer', ...def };
  registry.timer.push(full);
  if (inAzure()) {
    const { app } = azure();
    app.timer(def.name, { schedule: def.schedule, handler: async () => def.handler() });
  }
  return full;
}

export function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/* Helpers de respuesta */
export const ok = (json: unknown): Res => ({ status: 200, json });
export const created = (json: unknown): Res => ({ status: 201, json });
export const noContent = (): Res => ({ status: 204 });

/** Lee un entero de la query con valores por defecto y límites. */
export function qInt(req: Req, name: string, def: number, min = 1, max = 500): number {
  const v = Number(req.query.get(name));
  if (!Number.isFinite(v) || v === 0) return def;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}
