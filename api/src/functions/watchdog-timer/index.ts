import { watchdogTick } from '../../shared/alert-engine';
import { defineTimer } from '../../shared/http';
import { trackingRepo } from '../../shared/repositories/tracking';

/**
 * watchdog-timer: Timer trigger cada 5 s.
 *  - RE5: detecta pérdida de señal / fallo del GPS (sin datos > umbral de la regla).
 *  - RE4: detecta paradas prolongadas (respaldo del chequeo en ingest).
 *  - Cierra recorridos sin datos en los últimos 10 minutos.
 */
let ticks = 0;
defineTimer({
  name: 'watchdog-timer',
  schedule: '*/5 * * * * *',
  intervalMs: 5000,
  handler: () => {
    const r = watchdogTick();
    if (++ticks % 12 === 0) trackingRepo.closeStaleTrips(new Date(Date.now() - 10 * 60_000).toISOString());
    if (r.offline || r.alerts) console.log(JSON.stringify({ level: 'info', msg: 'watchdog', ...r }));
  },
});
