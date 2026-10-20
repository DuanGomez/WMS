import { config } from '../../shared/config';
import { all, get, id, now, run } from '../../shared/db';
import { badRequest, forbidden, notFound } from '../../shared/errors';
import { created, defineHttp, ok, Req } from '../../shared/http';
import { parse, z } from '../../shared/validation';
import { SCENARIOS, ScenarioType, SIM_FLEET } from './fleet';

/**
 * Funciones de control del simulador GPS (panel "Simulador" de la UI).
 * El proceso simulador (run.ts) consulta /simulator/control y reporta /simulator/heartbeat
 * usando una clave compartida (config.simulatorKey). La UI usa /simulator/state con JWT.
 */

export interface SimState {
  paused: boolean;
  speedFactor: number;
  scenarios: { id: string; vehicleKey: string; type: ScenarioType; durationS: number; requestedAt: string }[];
}

let heartbeat: {
  at: number;
  vehicles: { key: string; plate: string; mode: string; progress: number; speed: number; laps: number }[];
} = {
  at: 0,
  vehicles: [],
};

function readState(): SimState {
  const r = get<{ state: string }>(`SELECT state FROM simulator_state WHERE id = 1`);
  const s: SimState = r ? JSON.parse(r.state) : { paused: false, speedFactor: 1, scenarios: [] };
  // Descarta escenarios vencidos (con margen para desvíos que tardan en regresar)
  s.scenarios = s.scenarios.filter(
    (x) => Date.parse(x.requestedAt) + (x.durationS + 120) * 1000 > Date.now(),
  );
  return s;
}

function writeState(s: SimState) {
  run(
    `INSERT INTO simulator_state (id, state) VALUES (1, @s) ON CONFLICT(id) DO UPDATE SET state = excluded.state`,
    {
      s: JSON.stringify(s),
    },
  );
}

function checkKey(req: Req) {
  if (req.headers.get('x-simulator-key') !== config.simulatorKey) throw forbidden('Clave del simulador inválida.');
}

/** Vehículos simulados que pertenecen al tenant (para no exponer los de otras empresas). */
function tenantFleet(tenantId: string) {
  const plates = new Set(
    all<{ plate: string }>(`SELECT plate FROM vehicles WHERE company_id=@cid AND retired_at IS NULL`, {
      cid: tenantId,
    }).map((v) => v.plate),
  );
  return SIM_FLEET.filter((v) => plates.has(v.plate));
}

defineHttp({
  name: 'simulator-control',
  route: 'simulator/control',
  methods: ['GET'],
  guard: 'public',
  handler: (req) => {
    checkKey(req);
    return ok(readState());
  },
});

defineHttp({
  name: 'simulator-heartbeat',
  route: 'simulator/heartbeat',
  methods: ['POST'],
  guard: 'public',
  handler: (req) => {
    checkKey(req);
    heartbeat = { at: Date.now(), vehicles: Array.isArray(req.body?.vehicles) ? req.body.vehicles : [] };
    return ok({ ok: true });
  },
});

defineHttp({
  name: 'simulator-state',
  route: 'simulator/state',
  methods: ['GET'],
  guard: { module: 'simulator', level: 'read' },
  handler: (_req, ctx) => {
    const fleet = tenantFleet(ctx.tenantId);
    const keys = new Set(fleet.map((f) => f.key));
    const s = readState();
    return ok({
      connected: Date.now() - heartbeat.at < 6000,
      lastHeartbeatAt: heartbeat.at ? new Date(heartbeat.at).toISOString() : null,
      paused: s.paused,
      speedFactor: s.speedFactor,
      scenarios: s.scenarios.filter((x) => keys.has(x.vehicleKey)),
      catalog: Object.entries(SCENARIOS).map(([k, v]) => ({ id: k, ...v })),
      vehicles: fleet.map((f) => {
        const hb = heartbeat.vehicles.find((v) => v.key === f.key);
        return {
          key: f.key,
          plate: f.plate,
          type: f.type,
          label: f.label,
          mode: hb?.mode ?? 'offline',
          progress: hb?.progress ?? 0,
          speed: hb?.speed ?? 0,
          laps: hb?.laps ?? 0,
        };
      }),
    });
  },
});

/* Pausar / reanudar / velocidad x1-x4 (global para el simulador de la demo) */
defineHttp({
  name: 'simulator-update',
  route: 'simulator/state',
  methods: ['PATCH'],
  guard: { module: 'simulator', level: 'write' },
  handler: (req) => {
    const body = parse(
      z.object({ paused: z.boolean().optional(), speedFactor: z.number().int().min(1).max(4).optional() }),
      req.body,
    );
    const s = readState();
    writeState({ ...s, ...body });
    return ok({ ...readState() });
  },
});

/* Activar escenario de demo: parada prolongada, pérdida de señal, desvío o robo */
defineHttp({
  name: 'simulator-scenario',
  route: 'simulator/scenarios',
  methods: ['POST'],
  guard: { module: 'simulator', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(
      z.object({ vehicleKey: z.string(), type: z.enum(['stop', 'signal_loss', 'deviation', 'theft']) }),
      req.body,
    );
    if (!tenantFleet(ctx.tenantId).some((f) => f.key === body.vehicleKey))
      throw notFound('Vehículo simulado');
    const s = readState();
    if (s.scenarios.some((x) => x.vehicleKey === body.vehicleKey)) {
      throw badRequest('Ese vehículo ya tiene un escenario en curso. Espera a que termine.');
    }
    const scenario = {
      id: id(),
      vehicleKey: body.vehicleKey,
      type: body.type,
      durationS: SCENARIOS[body.type].durationS,
      requestedAt: now(),
    };
    s.scenarios.push(scenario);
    writeState(s);
    return created(scenario);
  },
});
