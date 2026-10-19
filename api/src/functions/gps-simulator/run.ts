/**
 * Proceso simulador de dispositivos GPS (RG8). Actúa como los equipos físicos: cada segundo envía por HTTP
 * a tracking-ingest el payload {deviceId, lat, lng, speed, heading, battery, accuracy, timestamp} autenticado
 * con la API key del dispositivo. Ejecutar: npm run dev:sim (lo lanza `npm run dev` automáticamente).
 */
import '../../shared/config';
import { createSimulator } from './loop';

const API = (process.env.INGEST_URL ?? `http://localhost:${process.env.PORT ?? 7071}/api`).replace(/\/$/, '');
const TICK_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
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

const sim = createSimulator({ call, target: API });

async function main() {
  console.log(
    `🛰️  Iniciando simulador GPS (ruta: ${sim.route.points.length} puntos, ${(sim.route.length / 1000).toFixed(1)} km)`,
  );
  for (;;) {
    const started = Date.now();
    await sim.tick();
    await sleep(Math.max(50, TICK_MS - (Date.now() - started)));
  }
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
main();
