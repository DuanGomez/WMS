import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/shared/db';
import { destination } from '../src/shared/geo';
import { SIM_FLEET } from '../src/functions/gps-simulator/fleet';
import { LA72 } from '../src/functions/gps-simulator/waypoints';
import { bearer, bootstrap, login } from './helpers';

let app: any;
let adminToken: string;
const moto = SIM_FLEET.find((f) => f.key === 'moto')!;

const ingest = (
  key: string,
  p: { lat: number; lng: number; speed?: number; ignition?: boolean; timestamp?: string },
) =>
  request(app)
    .post('/api/tracking/ingest')
    .set('x-device-key', key)
    .send({ speed: 30, battery: 90, ...p });

beforeAll(async () => {
  app = await bootstrap();
  adminToken = (await login(app, 'admin@la72.co')).accessToken;
});

describe('CP-R01 · Persistencia y rearme de alerta crítica de robo (R-01, RG4)', () => {
  it('mantiene firing durante paradas con encendido apagado y rearma solo al encender legítimamente', async () => {
    const p = destination(LA72, 220, 1800);
    const before = (
      await request(app).get('/api/alerts?type=theft&limit=200').set(bearer(adminToken))
    ).body.items.filter((a: any) => a.vehiclePlate === moto.plate).length;

    // 1. Movimiento con encendido apagado → dispara robo
    await ingest(moto.apiKey, { lat: p[0], lng: p[1], speed: 35, ignition: false });
    const afterFirst = (
      await request(app).get('/api/alerts?type=theft&limit=200').set(bearer(adminToken))
    ).body.items.filter((a: any) => a.vehiclePlate === moto.plate).length;
    expect(afterFirst).toBe(before + 1);

    // 2. Se detiene en un semáforo aún apagado (speed: 0, ignition: false) y vuelve a moverse apagado → NO debe duplicar la misma alerta
    await ingest(moto.apiKey, { lat: p[0], lng: p[1], speed: 0, ignition: false });
    await ingest(moto.apiKey, { lat: p[0], lng: p[1], speed: 40, ignition: false });
    const afterStopStillStolen = (
      await request(app).get('/api/alerts?type=theft&limit=200').set(bearer(adminToken))
    ).body.items.filter((a: any) => a.vehiclePlate === moto.plate).length;
    expect(afterStopStillStolen).toBe(afterFirst);

    // 3. El vehículo se enciende legítimamente (ignition: true) → rearma el estado firing
    await ingest(moto.apiKey, { lat: p[0], lng: p[1], speed: 20, ignition: true });

    // 4. Un nuevo evento de movimiento apagado posterior sí genera una segunda alerta crítica
    await ingest(moto.apiKey, { lat: p[0], lng: p[1], speed: 38, ignition: false });
    const afterSecondTheft = (
      await request(app).get('/api/alerts?type=theft&limit=200').set(bearer(adminToken))
    ).body.items.filter((a: any) => a.vehiclePlate === moto.plate).length;
    expect(afterSecondTheft).toBe(afterFirst + 1);
  });
});

describe('CP-R02 · Botón de emergencia del conductor y aislamiento entre empresas (R-01, R-02)', () => {
  it('el conductor activa emergencia crítica con ubicación fresca del celular y otra empresa no la ve', async () => {
    const driver = await login(app, 'conductor@la72.co');
    const otherTenant = await login(app, 'admin@eltrigal.co');

    // El conductor reporta ubicación desde su celular
    await request(app)
      .post('/api/me/location')
      .set(bearer(driver.accessToken))
      .send({ lat: 6.2518, lng: -75.5905, accuracy: 8, speed: 5 })
      .expect(200);

    // Activa el botón de emergencia
    const em = await request(app)
      .post('/api/me/emergency')
      .set(bearer(driver.accessToken))
      .send({ message: 'Intento de hurto en semáforo de la 70' })
      .expect(201);

    expect(em.body.type).toBe('emergency');
    expect(em.body.priority).toBe('critical');
    expect(em.body.lat).toBeCloseTo(6.2518, 4);
    expect(em.body.description).toContain('Intento de hurto');

    // El administrador de la misma empresa la recibe
    const listA = (
      await request(app).get('/api/alerts?type=emergency&limit=50').set(bearer(adminToken))
    ).body.items;
    expect(listA.some((a: any) => a.id === em.body.id)).toBe(true);

    // Otra empresa NO puede ver la alerta de emergencia
    const listB = (
      await request(app).get('/api/alerts?type=emergency&limit=50').set(bearer(otherTenant.accessToken))
    ).body.items;
    expect(listB.some((a: any) => a.id === em.body.id)).toBe(false);
  });
});

describe('CP-R03 · Revocación de credenciales GPS por inactividad, rotación o baja por robo (R-03, RF28, RF31)', () => {
  it('bloquea ingesta cuando el GPS está inactivo, se rota su API key o se da de baja por robo', async () => {
    // Registrar un dispositivo nuevo
    const created = await request(app)
      .post('/api/devices')
      .set(bearer(adminToken))
      .send({ serial: 'GPS-RISK-900', model: 'Teltonika FMB920', status: 'inactive' })
      .expect(201);

    const oldKey = created.body.apiKey;
    expect(oldKey).toBeTruthy();

    // 1. Dispositivo inactivo → 403 Forbidden
    const rInactive = await ingest(oldKey, { lat: 6.25, lng: -75.59 });
    expect(rInactive.status).toBe(403);

    // Activar dispositivo → 202 (sin vehículo asociado, pero autenticado)
    await request(app)
      .patch(`/api/devices/${created.body.id}`)
      .set(bearer(adminToken))
      .send({ status: 'active' })
      .expect(200);
    expect((await ingest(oldKey, { lat: 6.25, lng: -75.59 })).status).toBe(202);

    // 2. Rotar API key → la clave anterior queda invalidada (401)
    const rotated = await request(app)
      .post(`/api/devices/${created.body.id}/regenerate-key`)
      .set(bearer(adminToken))
      .expect(200);
    expect(rotated.body.apiKey).not.toBe(oldKey);
    expect((await ingest(oldKey, { lat: 6.25, lng: -75.59 })).status).toBe(401);
    expect((await ingest(rotated.body.apiKey, { lat: 6.25, lng: -75.59 })).status).toBe(202);

    // 3. Dar de baja por robo → la clave actual deja de ser aceptada (401)
    await request(app)
      .delete(`/api/devices/${created.body.id}?reason=robado`)
      .set(bearer(adminToken))
      .expect(204);
    expect((await ingest(rotated.body.apiKey, { lat: 6.25, lng: -75.59 })).status).toBe(401);
  });
});

describe('CP-R04 · Prevención de escalamiento de privilegios (R-02, RG9, RF32)', () => {
  it('impide que un supervisor o conductor se auto-asigne permisos de escritura en usuarios o facturación', async () => {
    const sup = await login(app, 'supervisor@la72.co');
    const drv = await login(app, 'conductor@la72.co');

    const r1 = await request(app)
      .put(`/api/users/${sup.user.id}/permissions`)
      .set(bearer(sup.accessToken))
      .send({ permissions: { ...sup.user.permissions, users: 'write', billing: 'write' } });
    expect(r1.status).toBe(403);

    const r2 = await request(app)
      .patch(`/api/users/${drv.user.id}`)
      .set(bearer(drv.accessToken))
      .send({ role: 'admin' });
    expect(r2.status).toBe(403);
  });
});

describe('CP-R05 · Restricción operativa con suscripción cancelada y reactivación (R-04, RG7, RF25, RF26)', () => {
  it('bloquea escrituras operativas al cancelar la suscripción pero permite lecturas y reactivación del plan', async () => {
    // Crear empresa aislada para probar el ciclo de cancelación sin afectar los demás tests
    const signup = await request(app)
      .post('/api/companies/signup')
      .send({
        company: {
          name: 'Logística Riesgo S.A.S.',
          nit: '901555444-3',
          email: 'contacto@logisticariesgo.co',
          phone: '3005554433',
          city: 'Medellín',
        },
        owner: { name: 'Carlos Dueño', email: 'carlos@logisticariesgo.co', password: 'Clave2026x' },
        planCode: 'pro',
      })
      .expect(201);

    const ownerToken = signup.body.accessToken;

    // Cancelar suscripción
    await request(app)
      .post('/api/subscription/cancel')
      .set(bearer(ownerToken))
      .send({ reason: 'Cierre temporal de operaciones' })
      .expect(200);

    // Intentar crear un vehículo con suscripción cancelada → 403 Forbidden
    const createBlocked = await request(app)
      .post('/api/vehicles')
      .set(bearer(ownerToken))
      .send({ plate: 'RSK123', type: 'camion' });
    expect(createBlocked.status).toBe(403);
    expect(createBlocked.body.message).toContain('cancelada');

    // Lectura de vehículos sigue permitida → 200 OK
    await request(app).get('/api/vehicles').set(bearer(ownerToken)).expect(200);

    // Reactivar cambiando/renovando plan en billing → 200 OK
    await request(app)
      .put('/api/subscription/plan')
      .set(bearer(ownerToken))
      .send({ planCode: 'pro' })
      .expect(200);

    // Ahora sí permite crear el vehículo → 201 Created
    await request(app)
      .post('/api/vehicles')
      .set(bearer(ownerToken))
      .send({ plate: 'RSK123', type: 'camion' })
      .expect(201);
  });
});

describe('CP-R06 · Caducidad y revocación de enlaces públicos de reportes (R-07, RF33)', () => {
  it('rechaza el acceso y la descarga cuando el enlace compartido ha expirado o fue revocado', async () => {
    const rep = await request(app)
      .post('/api/reports')
      .set(bearer(adminToken))
      .send({
        name: 'Auditoria Riesgo',
        type: 'alerts',
        format: 'pdf',
        periodStart: new Date(Date.now() - 3 * 86400_000).toISOString(),
        periodEnd: new Date().toISOString(),
      })
      .expect(201);

    const share = await request(app)
      .post(`/api/reports/${rep.body.id}/share`)
      .set(bearer(adminToken))
      .send({ mode: 'link', expiresInHours: 1 })
      .expect(201);

    // Simular vencimiento del token en la base de datos
    run(`UPDATE report_shares SET expires_at = @past WHERE id = @id`, {
      past: new Date(Date.now() - 60_000).toISOString(),
      id: share.body.id,
    });

    const expiredMeta = await request(app).get(`/api/public/reports/${share.body.token}`);
    expect(expiredMeta.status).toBe(400);
    expect(expiredMeta.body.message).toContain('expiró');

    const expiredDownload = await request(app).get(`/api/public/reports/${share.body.token}/download`);
    expect(expiredDownload.status).toBe(400);
  });
});

describe('CP-R07 · Resiliencia ante timestamps GPS fuera de ventana (Time-Spoofing / reloj desincronizado) (R-05)', () => {
  it('normaliza timestamps a >10 min en el futuro o pasado usando la hora del servidor sin corromper el estado', async () => {
    const p = destination(LA72, 120, 900);
    const futureTs = new Date(Date.now() + 3 * 3600_000).toISOString(); // +3 horas en el futuro

    const before = Date.now();
    const r = await ingest(moto.apiKey, {
      lat: p[0],
      lng: p[1],
      speed: 25,
      ignition: true,
      timestamp: futureTs,
    });
    const after = Date.now();

    expect(r.status).toBe(200);
    const v = (await request(app).get(`/api/vehicles/${r.body.vehicleId}`).set(bearer(adminToken))).body;
    const savedTs = Date.parse(v.live.ts);

    // El timestamp guardado debe corresponder a la hora del servidor, no a +3 horas
    expect(savedTs).toBeGreaterThanOrEqual(before - 1000);
    expect(savedTs).toBeLessThanOrEqual(after + 1000);
  });
});
