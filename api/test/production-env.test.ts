import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Ambiente de producción: se define antes de importar la configuración.
vi.hoisted(() => {
  process.env.APP_ENV = 'production';
  process.env.JWT_SECRET = 'prod-test-secret-con-mas-de-24-caracteres';
  process.env.JWT_REFRESH_SECRET = 'prod-test-refresh-con-mas-de-24-caracteres';
  process.env.SIMULATOR_KEY = 'prod-test-simulator-con-mas-de-24-caracteres';
  process.env.SUPPORT_EMAIL = 'soporte@miempresa.co';
  process.env.SUPPORT_PASSWORD = 'Soporte-Prod-2026';
});

import { ensureSystemData } from '../src/shared/catalog';
import { config } from '../src/shared/config';
import { get, getDb } from '../src/shared/db';
import { createApp } from '../src/local/server';
import { seed } from '../src/seed/demo';

let app: any;

beforeAll(async () => {
  await getDb();
  await ensureSystemData();
  app = createApp();
});

describe('Ambiente de producción', () => {
  it('arranca sin datos demo: solo el catálogo de planes y la cuenta de soporte configurada', async () => {
    expect(config.appEnv).toBe('production');
    expect(config.demoMode).toBe(false);
    expect(config.simulatorInProcess).toBe(false);
    expect((await get<{ n: number }>('SELECT COUNT(*) n FROM plans'))!.n).toBe(3);
    expect((await get<{ n: number }>('SELECT COUNT(*) n FROM vehicles'))!.n).toBe(0);
    expect((await get<{ n: number }>('SELECT COUNT(*) n FROM users WHERE role <> @r', { r: 'support' }))!.n).toBe(0);
    expect((await request(app).post('/api/auth/login').send({ email: 'admin@la72.co', password: 'Demo1234!' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'soporte@miempresa.co', password: 'Soporte-Prod-2026' })).status).toBe(200);
    // Volver a aplicar el catálogo no duplica nada
    await ensureSystemData();
    expect((await get<{ n: number }>('SELECT COUNT(*) n FROM plans'))!.n).toBe(3);
  });

  it('el seed de datos demo se niega a correr', async () => {
    await expect(seed({ quiet: true })).rejects.toThrow(/producción/);
  });

  it('una empresa se registra y su administrador invita conductores', async () => {
    const r = await request(app)
      .post('/api/companies/signup')
      .send({
        company: { name: 'Logística TdeA', nit: '900123456-7', email: 'contacto@logtdea.co', phone: '604 444 5555', city: 'Medellín' },
        owner: { name: 'Duan Gómez', email: 'duan@logtdea.co', password: 'Clave-Segura-1' },
        planCode: 'flota',
      });
    expect(r.status).toBe(201);
    const inv = await request(app).post('/api/invites').set({ Authorization: `Bearer ${r.body.accessToken}` }).send({ label: 'Exposición' });
    expect(inv.status).toBe(201);
    const j = await request(app)
      .post(`/api/join/${inv.body.code}`)
      .send({ name: 'Asistente Expo', email: 'asistente@expo.co', phone: '300 000 0001', password: 'Expo2026!' });
    expect(j.status).toBe(201);
    const health = await request(app).get('/api/health');
    expect(health.body.env).toBe('production');
  });
});
