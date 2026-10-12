import http from 'node:http';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { watchdogTick } from '../src/shared/alert-engine';
import { run } from '../src/shared/db';
import { destination, LatLng } from '../src/shared/geo';
import { SIM_FLEET } from '../src/functions/gps-simulator/fleet';
import { LA72 } from '../src/functions/gps-simulator/waypoints';
import { bearer, bootstrap, login } from './helpers';

let app: any;
let token: string;
const moto = SIM_FLEET.find((f) => f.key === 'moto')!;
const carro = SIM_FLEET.find((f) => f.key === 'carro')!;

const ingest = (
  key: string,
  p: { lat: number; lng: number; speed?: number; ignition?: boolean; timestamp?: string },
) =>
  request(app)
    .post('/api/tracking/ingest')
    .set('x-device-key', key)
    .send({ speed: 30, battery: 90, ...p });

async function alerts(type?: string) {
  const r = await request(app)
    .get(`/api/alerts?limit=200${type ? `&type=${type}` : ''}`)
    .set(bearer(token));
  return r.body.items as any[];
}

beforeAll(async () => {
  app = await bootstrap();
  token = (await login(app, 'admin@la72.co')).accessToken;
});

describe('Ingesta GPS (RE1, RG8)', () => {
  it('rechaza dispositivos sin API key o con clave inválida', async () => {
    expect((await request(app).post('/api/tracking/ingest').send({ lat: 6.25, lng: -75.59 })).status).toBe(
      401,
    );
    expect((await ingest('gps_falsa', { lat: 6.25, lng: -75.59 })).status).toBe(401);
  });

  it('valida el payload (lat/lng obligatorios)', async () => {
    expect((await ingest(moto.apiKey, { lat: 200, lng: -75.59 })).status).toBe(400);
  });

  it('almacena la posición y actualiza la última ubicación del vehículo (RF2)', async () => {
    const p = destination(LA72, 0, 2000);
    const r = await ingest(moto.apiKey, { lat: p[0], lng: p[1], speed: 32 });
    expect(r.status).toBe(200);
    expect(r.body.stored).toBe(true);
    const v = (await request(app).get(`/api/vehicles/${r.body.vehicleId}`).set(bearer(token))).body;
    expect(v.live.lat).toBeCloseTo(p[0], 5);
    expect(v.live.speed).toBe(32);
    expect(v.device.connection).toBe('online');
  });
});

describe('Motor de alertas (RG4, RE3, RE4, RE5)', () => {
  it('genera alertas de entrada y salida de la geocerca circular (RE3)', async () => {
    const outside = destination(LA72, 90, 600);
    await ingest(carro.apiKey, { lat: outside[0], lng: outside[1] });
    await ingest(carro.apiKey, { lat: LA72[0], lng: LA72[1] });
    await ingest(carro.apiKey, { lat: outside[0], lng: outside[1] });
    const enter = (await alerts('geofence_enter')).filter(
      (a) => a.vehiclePlate === carro.plate && a.title.includes('entró'),
    );
    const exit = (await alerts('geofence_exit')).filter(
      (a) => a.vehiclePlate === carro.plate && a.title.includes('salió de «Supermercados'),
    );
    expect(enter.length).toBeGreaterThanOrEqual(1);
    expect(exit.length).toBeGreaterThanOrEqual(1);
  });

  it('detecta parada prolongada con umbral configurable, una sola vez por parada (RE4)', async () => {
    const p: LatLng = destination(LA72, 180, 300);
    const t0 = Date.now() - 40_000;
    for (const s of [0, 10, 20, 30, 35]) {
      await ingest(moto.apiKey, {
        lat: p[0],
        lng: p[1],
        speed: 0,
        timestamp: new Date(t0 + s * 1000).toISOString(),
      });
    }
    const stops = (await alerts('prolonged_stop')).filter(
      (a) => a.vehiclePlate === moto.plate && Date.parse(a.ts) > t0,
    );
    expect(stops).toHaveLength(1);
    expect(stops[0].priority).toBe('high');
  });

  it('detecta pérdida de señal del GPS desde el watchdog (RE5) y la recuperación', async () => {
    // Simula que el dispositivo del carro dejó de reportar hace 60 s
    run(`UPDATE devices SET last_seen_at=@t, connection='online' WHERE api_key=@k`, {
      t: new Date(Date.now() - 60_000).toISOString(),
      k: carro.apiKey,
    });
    const r = watchdogTick();
    expect(r.offline).toBeGreaterThanOrEqual(1);
    const loss = (await alerts('signal_loss')).filter(
      (a) => a.vehiclePlate === carro.plate && Date.now() - Date.parse(a.ts) < 10_000,
    );
    expect(loss).toHaveLength(1);
    // Llega una nueva posición: señal recuperada
    const p = destination(LA72, 90, 600);
    await ingest(carro.apiKey, { lat: p[0], lng: p[1] });
    expect((await alerts('signal_restored')).some((a) => a.vehiclePlate === carro.plate)).toBe(true);
  });

  it('robo: movimiento con el encendido apagado genera alerta crítica y notificaciones simuladas', async () => {
    const p = destination(LA72, 270, 3000);
    await ingest(moto.apiKey, { lat: p[0], lng: p[1], speed: 45, ignition: false });
    const theft = (await alerts('theft')).filter((a) => a.vehiclePlate === moto.plate);
    expect(theft[0]?.priority).toBe('critical');
    const sent = (await request(app).get('/api/notifications').set(bearer(token))).body;
    expect(sent.some((n: any) => n.channel === 'email' && n.subject.includes('robo'))).toBe(true);
    expect(sent.some((n: any) => n.channel === 'push')).toBe(true);
  });

  it('desvío de ruta fuera del corredor autorizado', async () => {
    const dev = (await alerts('route_deviation')).filter(
      (a) => a.vehiclePlate === moto.plate && Date.now() - Date.parse(a.ts) < 30_000,
    );
    expect(dev.length).toBeGreaterThanOrEqual(1);
  });

  it('CRUD de reglas: crear, actualizar y eliminar (RF15, RF17, RF18)', async () => {
    const c = await request(app)
      .post('/api/alert-rules')
      .set(bearer(token))
      .send({
        name: 'Velocidad en barrio',
        type: 'speeding',
        threshold: 30,
        channels: ['inapp'],
        priority: 'medium',
      })
      .expect(201);
    const u = await request(app)
      .patch(`/api/alert-rules/${c.body.id}`)
      .set(bearer(token))
      .send({ threshold: 35, active: false })
      .expect(200);
    expect(u.body.threshold).toBe(35);
    expect(u.body.active).toBe(false);
    await request(app).delete(`/api/alert-rules/${c.body.id}`).set(bearer(token)).expect(204);
    const list = (await request(app).get('/api/alert-rules').set(bearer(token))).body;
    expect(list.find((r: any) => r.id === c.body.id)).toBeUndefined();
  });
});

describe('E2E: GPS → ingest → stream en tiempo real → mapa', () => {
  it('una posición enviada por el GPS llega por SSE y por polling al frontend', async () => {
    const server = http.createServer(app).listen(0);
    const port = (server.address() as any).port;
    const received: any[] = [];
    const req = http.get(`http://127.0.0.1:${port}/api/tracking/stream?access_token=${token}`, (res) => {
      expect(res.headers['content-type']).toContain('text/event-stream');
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (chunk: string) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /event: (\w+)/.exec(block)?.[1];
          const data = /data: (.*)/.exec(block)?.[1];
          if (ev && data) received.push({ ev, data: JSON.parse(data) });
        }
      });
    });
    await new Promise((r) => setTimeout(r, 300));
    const since = new Date().toISOString();
    const p = destination(LA72, 45, 1500);
    await ingest(moto.apiKey, { lat: p[0], lng: p[1], speed: 28, ignition: true });
    await new Promise((r) => setTimeout(r, 300));
    req.destroy();
    server.close();

    const pos = received.find((x) => x.ev === 'position' && x.data.plate === moto.plate);
    expect(received[0]?.ev).toBe('hello');
    expect(pos).toBeTruthy();
    expect(pos.data.lat).toBeCloseTo(p[0], 5);
    expect(pos.data.connection).toBe('online');

    // Fallback por polling
    const poll = await request(app)
      .get(`/api/tracking/poll?since=${encodeURIComponent(since)}`)
      .set(bearer(token))
      .expect(200);
    expect(poll.body.positions.some((x: any) => x.plate === moto.plate)).toBe(true);

    // Otra empresa NO recibe la posición
    const other = (await login(app, 'admin@eltrigal.co')).accessToken;
    const pollB = await request(app)
      .get(`/api/tracking/poll?since=${encodeURIComponent(since)}`)
      .set(bearer(other))
      .expect(200);
    expect(pollB.body.positions.some((x: any) => x.plate === moto.plate)).toBe(false);
  });
});

describe('Reportes (RE6, RF19-RF22, RF33)', () => {
  it('genera PDF y Excel válidos, regenera, comparte por enlace y elimina', async () => {
    const body = {
      name: 'Prueba',
      type: 'full',
      periodStart: new Date(Date.now() - 7 * 86400_000).toISOString(),
      periodEnd: new Date().toISOString(),
    };
    const pdf = await request(app)
      .post('/api/reports')
      .set(bearer(token))
      .send({ ...body, format: 'pdf' })
      .expect(201);
    const file = await request(app)
      .get(`/api/reports/${pdf.body.id}/download`)
      .set(bearer(token))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect((file.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const xlsx = await request(app)
      .post('/api/reports')
      .set(bearer(token))
      .send({ ...body, format: 'xlsx', type: 'trips' })
      .expect(201);
    const xf = await request(app)
      .get(`/api/reports/${xlsx.body.id}/download`)
      .set(bearer(token))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect((xf.body as Buffer).subarray(0, 2).toString()).toBe('PK'); // contenedor ZIP de OOXML

    const regen = await request(app)
      .post(`/api/reports/${pdf.body.id}/regenerate`)
      .set(bearer(token))
      .send({ type: 'alerts' })
      .expect(200);
    expect(regen.body.version).toBe(2);
    expect(regen.body.type).toBe('alerts');

    const share = await request(app)
      .post(`/api/reports/${pdf.body.id}/share`)
      .set(bearer(token))
      .send({ mode: 'link', expiresInHours: 1 })
      .expect(201);
    const pub = await request(app).get(`/api/public/reports/${share.body.token}`).expect(200);
    expect(pub.body.name).toBe('Prueba');

    await request(app).delete(`/api/reports/${pdf.body.id}`).set(bearer(token)).expect(204);
    expect((await request(app).get(`/api/public/reports/${share.body.token}`)).status).toBe(404);
  });
});
