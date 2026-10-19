import { loadRoute, SimVehicle } from './engine';
import { SCENARIOS, SIM_FLEET } from './fleet';

/**
 * Bucle del simulador GPS, independiente del transporte: `call` envía la petición a la API
 * (por HTTP en `run.ts`, o directamente a las funciones en el demo de GitHub Pages).
 */
export type SimCall = (
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<unknown>;

export const SIMULATOR_KEY = (typeof process !== 'undefined' && process.env?.SIMULATOR_KEY) || 'wms-simulator-local-key';

export function createSimulator(opts: { call: SimCall; target: string; log?: (m: string) => void; warn?: (m: string) => void }) {
  const log = opts.log ?? console.log;
  const warn = opts.warn ?? console.warn;
  const route = loadRoute();
  const vehicles = SIM_FLEET.map((cfg) => new SimVehicle(cfg, route));
  const applied = new Set<string>();
  let paused = false;
  let speedFactor = 1;
  let apiUp = false;
  let warnedDown = false;
  let tickNo = 0;

  async function syncControl() {
    const s: any = await opts.call('/simulator/control', { headers: { 'x-simulator-key': SIMULATOR_KEY } });
    paused = !!s.paused;
    speedFactor = Math.min(4, Math.max(1, Number(s.speedFactor) || 1));
    for (const sc of s.scenarios ?? []) {
      if (applied.has(sc.id)) continue;
      applied.add(sc.id);
      const v = vehicles.find((x) => x.cfg.key === sc.vehicleKey);
      if (!v) continue;
      v.startScenario(sc.type, sc.durationS ?? SCENARIOS[sc.type as keyof typeof SCENARIOS].durationS);
      log(`🎬 Escenario «${SCENARIOS[sc.type as keyof typeof SCENARIOS]?.label ?? sc.type}» en ${v.cfg.plate}`);
    }
  }

  async function tick() {
    tickNo++;
    try {
      if (tickNo % 2 === 1 || !apiUp) await syncControl();
      if (!apiUp) {
        apiUp = true;
        warnedDown = false;
        log(
          `🛰️  Simulador GPS conectado a ${opts.target} — ${vehicles.length} vehículos en la ruta fija de Medellín (${(route.length / 1000).toFixed(1)} km)`,
        );
      }
    } catch (e) {
      if (apiUp || !warnedDown) warn(`⏳ Esperando la API en ${opts.target}… (${(e as Error).message})`);
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
            await opts.call('/tracking/ingest', {
              method: 'POST',
              headers: { 'x-device-key': v.cfg.apiKey },
              body: JSON.stringify({ deviceId: v.cfg.serial, ...payload }),
            });
          } catch (e) {
            if ((e as any).status === 401 || (e as any).status === 403) {
              if (tickNo % 30 === 1)
                warn(`🔑 ${v.cfg.plate}: dispositivo rechazado (${(e as Error).message}). ¿Ejecutaste npm run seed?`);
            } else if (tickNo % 10 === 1) warn(`⚠️  ${v.cfg.plate}: ${(e as Error).message}`);
          }
        }),
      );
    }

    if (tickNo % 2 === 0) {
      await opts
        .call('/simulator/heartbeat', {
          method: 'POST',
          headers: { 'x-simulator-key': SIMULATOR_KEY },
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
        })
        .catch(() => {});
    }
  }

  return { tick, route, vehicles };
}
