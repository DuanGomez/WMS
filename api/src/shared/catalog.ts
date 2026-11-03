import { config } from './config';
import { get, id, now, run, tx } from './db';

/**
 * Datos del sistema que existen en TODOS los ambientes (también en producción, que no tiene datos demo):
 * el catálogo de planes, sin el cual nadie podría registrar su empresa. Se aplica al arrancar la API.
 */
export const PLANS = [
  {
    code: 'basico',
    name: 'Básico',
    description: 'Para negocios que empiezan a rastrear su primer vehículo.',
    price: 89_000,
    vehicles: 3,
    users: 4,
    features: ['Hasta 3 vehículos', 'Mapa en tiempo real', 'Geocercas y alertas en plataforma', 'Reportes PDF', 'Soporte por correo'],
  },
  {
    code: 'pro',
    name: 'Pro',
    description: 'La opción ideal para pymes con domicilios y flota mixta.',
    price: 249_000,
    vehicles: 15,
    users: 15,
    features: [
      'Hasta 15 vehículos',
      'Alertas por correo y push',
      'Reportes PDF y Excel',
      'Compartir reportes',
      'Permisos granulares',
      'Soporte prioritario',
    ],
  },
  {
    code: 'flota',
    name: 'Flota',
    description: 'Para operaciones logísticas con decenas de vehículos.',
    price: 690_000,
    vehicles: 100,
    users: 60,
    features: [
      'Hasta 100 vehículos',
      'Todo lo del plan Pro',
      'Historial extendido',
      'Acompañamiento de implementación',
      'Soporte 24/7',
    ],
  },
];

/** Crea los planes que falten (no modifica los existentes). */
export async function ensurePlans() {
  for (const [i, p] of PLANS.entries()) {
    if (await get('SELECT 1 AS x FROM plans WHERE code=@code', { code: p.code })) continue;
    await run(
      `INSERT INTO plans (id, code, name, description, price_cop, max_vehicles, max_users, features, sort)
       VALUES (@id,@code,@name,@description,@price,@vehicles,@users,@features,@sort)`,
      { id: id(), ...p, features: JSON.stringify(p.features), sort: i },
    );
  }
}

/**
 * Cuenta de soporte de la plataforma (rol «support»), solo si se configuran SUPPORT_EMAIL y SUPPORT_PASSWORD y aún
 * no existe. En producción es la única cuenta que se crea sola; el resto se registra desde la app.
 */
export async function ensureSupportAccount() {
  const email = (process.env.SUPPORT_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.SUPPORT_PASSWORD ?? '';
  if (!email || !password) return;
  if (password.length < 10) {
    console.warn('⚠️  SUPPORT_PASSWORD debe tener al menos 10 caracteres: no se creó la cuenta de soporte.');
    return;
  }
  if (await get('SELECT 1 AS x FROM users WHERE email=@email', { email })) return;
  const { hashPassword } = await import('./auth');
  const hash = await hashPassword(password);
  await tx(async () => {
    let platform = await get<{ id: string }>('SELECT id FROM companies WHERE is_platform=1');
    if (!platform) {
      platform = { id: id() };
      await run(
        `INSERT INTO companies (id, name, nit, email, city, is_platform, created_at)
         VALUES (@id,'WMS Soporte','901000000-1',@email,'Medellín',1,@ts)`,
        { id: platform.id, email, ts: now() },
      );
    }
    await run(
      `INSERT INTO users (id, company_id, name, email, password_hash, role, permissions, phone, created_at, updated_at)
       VALUES (@id,@cid,'Soporte WMS',@email,@hash,'support','{}','',@ts,@ts)`,
      { id: id(), cid: platform.id, email, hash, ts: now() },
    );
  });
  console.log(`👤 Cuenta de soporte creada: ${email}`);
}

/** Todo lo que el sistema necesita para funcionar en una base nueva. */
export async function ensureSystemData() {
  await ensurePlans();
  if (config.appEnv !== 'local') await ensureSupportAccount();
}
