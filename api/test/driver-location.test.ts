import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { bearer, bootstrap, login } from './helpers';

let app: any;
beforeAll(async () => {
  app = await bootstrap();
});

describe('Ubicación del celular del conductor', () => {
  it('el conductor reporta su ubicación y el administrador la ve (mapa, polling y conductores)', async () => {
    const driver = await login(app, 'conductor@la72.co');
    const admin = await login(app, 'admin@la72.co');
    const since = new Date(Date.now() - 1000).toISOString();
    const r = await request(app)
      .post('/api/me/location')
      .set(bearer(driver.accessToken))
      .send({ lat: 6.2501, lng: -75.5905, accuracy: 8.4, speed: 5, heading: 90 })
      .expect(200);
    expect(r.body).toMatchObject({ name: 'Juan Pérez', vehiclePlate: 'KLM45E', sharing: true, accuracy: 8, speed: 18 });

    const live = await request(app).get('/api/tracking/live').set(bearer(admin.accessToken)).expect(200);
    expect(live.body.drivers.some((d: any) => d.name === 'Juan Pérez' && d.lat === 6.2501)).toBe(true);
    const poll = await request(app).get(`/api/tracking/poll?since=${encodeURIComponent(since)}`).set(bearer(admin.accessToken)).expect(200);
    expect(poll.body.drivers.map((d: any) => d.name)).toContain('Juan Pérez');
    const drivers = await request(app).get('/api/drivers').set(bearer(admin.accessToken)).expect(200);
    expect(drivers.body.find((d: any) => d.name === 'Juan Pérez').location.lat).toBe(6.2501);
  });

  it('pausar deja de compartir; otra empresa nunca ve al conductor', async () => {
    const driver = await login(app, 'conductor@la72.co');
    const since = new Date(Date.now() - 1).toISOString();
    await request(app).delete('/api/me/location').set(bearer(driver.accessToken)).expect(204);
    const admin = await login(app, 'admin@la72.co');
    const list = await request(app).get('/api/drivers/locations').set(bearer(admin.accessToken)).expect(200);
    expect(list.body.find((d: any) => d.name === 'Juan Pérez').sharing).toBe(false);
    // Sin SSE (demo de GitHub Pages) el mapa se entera de la pausa por polling.
    const poll = await request(app).get(`/api/tracking/poll?since=${encodeURIComponent(since)}`).set(bearer(admin.accessToken)).expect(200);
    expect(poll.body.drivers.find((d: any) => d.name === 'Juan Pérez')?.sharing).toBe(false);
    const other = await login(app, 'admin@eltrigal.co');
    const theirs = await request(app).get('/api/drivers/locations').set(bearer(other.accessToken)).expect(200);
    expect(theirs.body.some((d: any) => d.name === 'Juan Pérez')).toBe(false);
  });

  it('solo un conductor puede reportar ubicación', async () => {
    const admin = await login(app, 'admin@la72.co');
    expect((await request(app).post('/api/me/location').set(bearer(admin.accessToken)).send({ lat: 6.25, lng: -75.59 })).status).toBe(403);
  });
});
