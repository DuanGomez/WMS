/**
 * Proceso simulador de dispositivos GPS (RG8). Actúa como los equipos físicos: cada segundo envía por HTTP
 * a tracking-ingest el payload {deviceId, lat, lng, speed, heading, battery, accuracy, timestamp} autenticado
 * con la API key del dispositivo. Ejecutar: npm run dev:sim (lo lanza `npm run dev` automáticamente).
 */
import '../../shared/config';
import { loadRoute, SimVehicle } from './engine';
import { SCENARIOS, SIM_FLEET } from './fleet';

const API = (process.env.INGEST_URL ?? `http://localhost:${process.env.PORT ?? 7071}/api`).replace(/\/$/, '');
const SIM_KEY = process.env.SIMULATOR_KEY ?? 'wms-simulator-local-key';
const TICK_MS = 1000;

const route = loadRoute();
const vehicles = SIM_FLEET.map((cfg) => new SimVehicle(cfg, route));
const applied = new Set<string>();
let paused = false;
let speedFactor = 1;
let apiUp = false;
let warnedDown = false;
let tickNo = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok && res.status !== 202) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`${res.status} ${text.slice(0, 200)}`), { status: res.status });
  }
  return res.status === 204 ? null : res.json();
}

async function syncControl() {
  const s: any = await call('/simulator/control', { headers: { 'x-simulator-key': SIM_KEY } });
  paused = !!s.paused;
  speedFactor = Math.min(4, Math.max(1, Number(s.speedFactor) || 1));
  for (const sc of s.scenarios ?? []) {
    if (applied.has(sc.id)) continue;
    applied.add(sc.id);
    const v = vehicles.find((x) => x.cfg.key === sc.vehicleKey);
    if (!v) continue;
    v.startScenario(sc.type, sc.durationS ?? SCENARIOS[sc.type as keyof typeof SCENARIOS].durationS);
    console.log(
      `🎬 Escenario «${SCENARIOS[sc.type as keyof typeof SCENARIOS]?.label ?? sc.type}» en ${v.cfg.plate}`,
    );
  }
}

async function tick() {
  tickNo++;
  try {
    if (tickNo % 2 === 1 || !apiUp) await syncControl();
    if (!apiUp) {
      apiUp = true;
      warnedDown = false;
      console.log(
        `🛰️  Simulador GPS conectado a ${API} — ${vehicles.length} vehículos en la ruta fija de Medellín (${(route.length / 1000).toFixed(1)} km)`,
      );
    }
  } catch (e) {
    if (apiUp || !warnedDown) console.warn(`⏳ Esperando la API en ${API}… (${(e as Error).message})`);
    apiUp = false;
    warnedDown = true;
    return;
  }

  if (!paused) {
    const dt = speedFactor;
    await Promise.all(
      vehicles.map(async (v) => {
        const payload = v.tick(dt, 1);
        if (!payload) return; // pérdida de señal simulada
        try {
          await call('/tracking/ingest', {
            method: 'POST',
            headers: { 'x-device-key': v.cfg.apiKey },
            body: JSON.stringify({ deviceId: v.cfg.serial, ...payload }),
          });
        } catch (e) {
          if ((e as any).status === 401 || (e as any).status === 403) {
            if (tickNo % 30 === 1)
              console.warn(
                `🔑 ${v.cfg.plate}: dispositivo rechazado (${(e as Error).message}). ¿Ejecutaste npm run seed?`,
              );
          } else if (tickNo % 10 === 1) console.warn(`⚠️  ${v.cfg.plate}: ${(e as Error).message}`);
        }
      }),
    );
  }

  if (tickNo % 2 === 0) {
    await call('/simulator/heartbeat', {
      method: 'POST',
      headers: { 'x-simulator-key': SIM_KEY },
      body: JSON.stringify({
        vehicles: vehicles.map((v) => ({
          key: v.cfg.key,
          plate: v.cfg.plate,
          mode: paused ? 'paused' : v.mode,
          progress: v.progress,
          speed: Math.round(v.speed),
          laps: v.laps,
        })),
      }),
    }).catch(() => {});
  }
}

async function main() {
  console.log(
    `🛰️  Iniciando simulador GPS (ruta: ${route.points.length} puntos, ${(route.length / 1000).toFixed(1)} km)`,
  );
  for (;;) {
    const started = Date.now();
    await tick();
    await sleep(Math.max(50, TICK_MS - (Date.now() - started)));
  }
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
main();
