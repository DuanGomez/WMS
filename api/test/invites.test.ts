import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { bearer, bootstrap, login } from './helpers';

let app: any;
let admin: string;

beforeAll(async () => {
  app = await bootstrap();
  admin = (await login(app, 'admin@la72.co')).accessToken;
});

const join = (code: string, n: number, extra: Record<string, unknown> = {}) =>
  request(app)
    .post(`/api/join/${code}`)
    .send({ name: `Asistente ${n}`, email: `asistente${n}@expo.co`, phone: '300 123 4567', password: 'Expo2026!', ...extra });

describe('Invitaciones de conductores (registro desde el celular)', () => {
  it('el administrador crea una invitación y la persona se registra como conductor con sesión iniciada', async () => {
    const inv = await request(app).post('/api/invites').set(bearer(admin)).send({ label: 'Exposición TdeA', maxUses: 2 });
    expect(inv.status).toBe(201);
    expect(inv.body.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(inv.body.valid).toBe(true);

    const info = await request(app).get(`/api/join/${inv.body.code.toLowerCase()}`);
    expect(info.status).toBe(200);
    expect(info.body.company).toBe('Supermercados la 72');
    expect(info.body.label).toBe('Exposición TdeA');

    const r = await join(inv.body.code, 1);
    expect(r.status).toBe(201);
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.user.role).toBe('driver');

    // Ya puede compartir su ubicación y el administrador la ve en el mapa
    const loc = await request(app)
      .post('/api/me/location')
      .set(bearer(r.body.accessToken))
      .send({ lat: 6.2768, lng: -75.5898, accuracy: 15 });
    expect(loc.status).toBe(200);
    const live = await request(app).get('/api/tracking/live').set(bearer(admin));
    expect(live.body.drivers.some((d: any) => d.name === 'Asistente 1' && Math.abs(d.lat - 6.2768) < 1e-6)).toBe(true);
  });

  it('respeta el cupo, rechaza correos repetidos y códigos inválidos', async () => {
    const inv = (await request(app).post('/api/invites').set(bearer(admin)).send({ maxUses: 1 })).body;
    expect((await join(inv.code, 2)).status).toBe(201);
    expect((await join(inv.code, 3)).status).toBe(404); // agotada: ya no es vigente
    const other = (await request(app).post('/api/invites').set(bearer(admin)).send({})).body;
    expect((await join(other.code, 2)).status).toBe(409); // correo ya registrado
    expect((await request(app).get('/api/join/NOEXISTE')).status).toBe(404);
  });

  it('una invitación revocada deja de funcionar y solo la ve su empresa', async () => {
    const inv = (await request(app).post('/api/invites').set(bearer(admin)).send({})).body;
    expect((await request(app).delete(`/api/invites/${inv.id}`).set(bearer(admin))).status).toBe(204);
    expect((await join(inv.code, 4)).status).toBe(404);
    const trigal = (await login(app, 'admin@eltrigal.co')).accessToken;
    const list = (await request(app).get('/api/invites').set(bearer(trigal))).body;
    expect(list.some((i: any) => i.id === inv.id)).toBe(false);
    expect((await request(app).delete(`/api/invites/${inv.id}`).set(bearer(trigal))).status).toBe(404);
  });

  it('un conductor no puede crear invitaciones', async () => {
    const driver = (await login(app, 'conductor@la72.co')).accessToken;
    expect((await request(app).post('/api/invites').set(bearer(driver)).send({})).status).toBe(403);
  });
});
