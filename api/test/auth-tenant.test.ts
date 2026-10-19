import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { bearer, bootstrap, login } from './helpers';

let app: any;
beforeAll(async () => {
  app = await bootstrap();
});

describe('Autenticación (RF13, RF14, RF27)', () => {
  it('login correcto devuelve tokens y permisos por rol', async () => {
    const s = await login(app, 'supervisor@la72.co');
    expect(s.accessToken).toBeTruthy();
    expect(s.user.role).toBe('supervisor');
    expect(s.user.permissions.billing).toBe('none');
    expect(s.user.permissions.users).toBe('read'); // permiso granular personalizado en el seed (RF32)
  });

  it('credenciales inválidas → 401 con mensaje en español', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'admin@la72.co', password: 'mala' });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: 'UNAUTHORIZED', message: expect.stringContaining('incorrectos') });
  });

  it('rate limit en login tras intentos fallidos', async () => {
    let last = 0;
    for (let i = 0; i < 10; i++)
      last = (await request(app).post('/api/auth/login').send({ email: 'gerencia@la72.co', password: 'x' }))
        .status;
    expect(last).toBe(429);
  });

  it('refresh rota el token y logout lo invalida', async () => {
    const s = await login(app, 'admin@la72.co');
    const r1 = await request(app).post('/api/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(r1.status).toBe(200);
    // el refresh usado ya no sirve (rotación)
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: s.refreshToken })).status).toBe(
      401,
    );
    await request(app).post('/api/auth/logout').send({ refreshToken: r1.body.refreshToken }).expect(204);
    expect(
      (await request(app).post('/api/auth/refresh').send({ refreshToken: r1.body.refreshToken })).status,
    ).toBe(401);
  });

  it('sin token → 401; validación con zod → 400 VALIDATION_ERROR', async () => {
    expect((await request(app).get('/api/vehicles')).status).toBe(401);
    const s = await login(app, 'admin@la72.co');
    const r = await request(app)
      .post('/api/vehicles')
      .set(bearer(s.accessToken))
      .send({ plate: 'x', type: 'avion' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('VALIDATION_ERROR');
  });

  it('cambio de contraseña con la actual', async () => {
    const s = await login(app, 'laura.gomez@la72.co');
    await request(app)
      .post('/api/auth/change-password')
      .set(bearer(s.accessToken))
      .send({ currentPassword: 'Demo1234!', newPassword: 'Nueva2026x' })
      .expect(200);
    await login(app, 'laura.gomez@la72.co', 'Nueva2026x');
  });
});

describe('Roles y permisos (RG9, RF32)', () => {
  it('el conductor no puede gestionar usuarios ni ver facturación', async () => {
    const s = await login(app, 'conductor@la72.co');
    expect((await request(app).get('/api/users').set(bearer(s.accessToken))).status).toBe(403);
    expect((await request(app).get('/api/subscription').set(bearer(s.accessToken))).status).toBe(403);
  });

  it('el conductor sólo ve su propio vehículo', async () => {
    const s = await login(app, 'conductor@la72.co');
    const r = await request(app).get('/api/vehicles').set(bearer(s.accessToken)).expect(200);
    expect(r.body.map((v: any) => v.plate)).toEqual(['KLM45E']);
  });

  it('un permiso granular revocado bloquea el módulo', async () => {
    const admin = await login(app, 'admin@la72.co');
    const users = (await request(app).get('/api/users').set(bearer(admin.accessToken))).body;
    const sup = users.find((u: any) => u.email === 'supervisor@la72.co');
    await request(app)
      .put(`/api/users/${sup.id}/permissions`)
      .set(bearer(admin.accessToken))
      .send({ permissions: { ...sup.permissions, reports: 'none' } })
      .expect(200);
    const s = await login(app, 'supervisor@la72.co');
    expect((await request(app).get('/api/reports').set(bearer(s.accessToken))).status).toBe(403);
  });
});

describe('Aislamiento multi-tenant (RE8, RG10)', () => {
  it('cada empresa sólo lista sus vehículos', async () => {
    const a = await login(app, 'admin@la72.co');
    const b = await login(app, 'admin@eltrigal.co');
    const va = (await request(app).get('/api/vehicles').set(bearer(a.accessToken))).body.map(
      (v: any) => v.plate,
    );
    const vb = (await request(app).get('/api/vehicles').set(bearer(b.accessToken))).body.map(
      (v: any) => v.plate,
    );
    expect(va).toContain('KLM45E');
    expect(va).not.toContain('HTZ210');
    expect(vb).toEqual(['HTZ210']);
  });

  it('acceder a un recurso de otra empresa por id → 404 (no se filtra existencia)', async () => {
    const a = await login(app, 'admin@la72.co');
    const b = await login(app, 'admin@eltrigal.co');
    const moto = (await request(app).get('/api/vehicles').set(bearer(a.accessToken))).body.find(
      (v: any) => v.plate === 'KLM45E',
    );
    expect((await request(app).get(`/api/vehicles/${moto.id}`).set(bearer(b.accessToken))).status).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/vehicles/${moto.id}`)
          .set(bearer(b.accessToken))
          .send({ color: 'Negro' })
      ).status,
    ).toBe(404);
    expect((await request(app).delete(`/api/vehicles/${moto.id}`).set(bearer(b.accessToken))).status).toBe(
      404,
    );
    const g = (await request(app).get('/api/geofences').set(bearer(a.accessToken))).body[0];
    expect((await request(app).get(`/api/geofences/${g.id}`).set(bearer(b.accessToken))).status).toBe(404);
  });

  it('alertas, reportes y geocercas no se mezclan entre empresas', async () => {
    const b = await login(app, 'admin@eltrigal.co');
    const alerts = (await request(app).get('/api/alerts?limit=500').set(bearer(b.accessToken))).body.items;
    expect(alerts.every((x: any) => x.vehiclePlate === 'HTZ210' || x.vehiclePlate === null)).toBe(true);
    expect((await request(app).get('/api/reports').set(bearer(b.accessToken))).body).toHaveLength(0);
    expect(
      (await request(app).get('/api/geofences').set(bearer(b.accessToken))).body.map((g: any) => g.name),
    ).toEqual(['Panadería El Trigal – Estadio', 'Zona de reparto El Trigal']);
  });

  it('no se puede asociar un dispositivo de otra empresa', async () => {
    const a = await login(app, 'admin@la72.co');
    const b = await login(app, 'admin@eltrigal.co');
    const devB = (await request(app).get('/api/devices').set(bearer(b.accessToken))).body[0];
    const r = await request(app)
      .post('/api/vehicles')
      .set(bearer(a.accessToken))
      .send({ plate: 'ZZZ999', type: 'carro', deviceId: devB.id });
    expect(r.status).toBe(404);
  });
});

describe('Planes de suscripción (RG7)', () => {
  it('el plan Básico limita el número de vehículos con un mensaje claro', async () => {
    const b = await login(app, 'admin@eltrigal.co');
    await request(app)
      .post('/api/vehicles')
      .set(bearer(b.accessToken))
      .send({ plate: 'AAA111', type: 'moto' })
      .expect(201);
    await request(app)
      .post('/api/vehicles')
      .set(bearer(b.accessToken))
      .send({ plate: 'AAA112', type: 'moto' })
      .expect(201);
    const r = await request(app)
      .post('/api/vehicles')
      .set(bearer(b.accessToken))
      .send({ plate: 'AAA113', type: 'moto' });
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('PLAN_LIMIT');
    expect(r.body.message).toContain('Básico');
  });

  it('registro de una nueva empresa con plan (RF23)', async () => {
    const r = await request(app)
      .post('/api/companies/signup')
      .send({
        company: {
          name: 'Restaurante Prueba',
          nit: '901999888-1',
          email: 'info@prueba.co',
          phone: '3001112233',
          city: 'Medellín',
        },
        owner: { name: 'Ana Prueba', email: 'ana@prueba.co', password: 'Clave2026x' },
        planCode: 'pro',
      })
      .expect(201);
    expect(r.body.user.company.name).toBe('Restaurante Prueba');
    const sub = await request(app).get('/api/subscription').set(bearer(r.body.accessToken)).expect(200);
    expect(sub.body.plan.code).toBe('pro');
    expect(sub.body.usage.vehicles).toBe(0);
  });
});
