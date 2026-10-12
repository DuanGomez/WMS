import request from 'supertest';
import { createApp } from '../src/local/server';
import { seed } from '../../scripts/seed';

export async function bootstrap() {
  await seed({ quiet: true });
  return createApp();
}

export async function login(app: any, email: string, password = 'Demo1234!') {
  const r = await request(app).post('/api/auth/login').send({ email, password });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { accessToken: string; refreshToken: string; user: any };
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
