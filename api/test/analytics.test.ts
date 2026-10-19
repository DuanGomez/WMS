import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { bearer, bootstrap, login } from './helpers';

let app: any;
let token: string;

beforeAll(async () => {
  app = await bootstrap();
  token = (await login(app, 'admin@la72.co')).accessToken;
});

describe('GET /api/analytics', () => {
  it('devuelve periodo actual y anterior con la misma cantidad de buckets', async () => {
    for (const days of [7, 30, 90]) {
      const r = await request(app).get(`/api/analytics?days=${days}`).set(bearer(token));
      expect(r.status).toBe(200);
      expect(r.body.range).toBe(days);
      expect(r.body.days.length).toBe(r.body.prevDays.length);
      expect(r.body.days.length).toBe(days === 90 ? 13 : days);
      expect(Array.isArray(r.body.topDrivers)).toBe(true);
    }
  });
  it('exige sesión', async () => {
    const r = await request(app).get('/api/analytics');
    expect(r.status).toBe(401);
  });
});
