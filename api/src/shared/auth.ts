import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config';
import { get, id, now, parseJson, bool, run } from './db';
import { forbidden, unauthorized } from './errors';
import { can, effectivePermissions, Level, Module, PermissionMap, Role } from './permissions';

export interface AuthUser {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: Role;
  permissions: PermissionMap;
  isPlatform: boolean;
  subscriptionStatus: string | null;
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
export const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function signAccessToken(user: { id: string; company_id: string; role: string }): string {
  return jwt.sign({ sub: user.id, cid: user.company_id, role: user.role }, config.jwtSecret, {
    expiresIn: config.accessTtl as jwt.SignOptions['expiresIn'],
    issuer: 'wms',
  });
}

export function issueRefreshToken(userId: string): string {
  const token = randomToken(48);
  const expires = new Date(Date.now() + config.refreshTtlDays * 86400_000).toISOString();
  run(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (@id, @uid, @h, @exp, @now)`,
    { id: id(), uid: userId, h: sha256(token), exp: expires, now: now() },
  );
  return token;
}

/** Rotación: el refresh token usado se revoca y se emite uno nuevo. */
export function consumeRefreshToken(token: string): string {
  const row = get<{ id: string; user_id: string; expires_at: string; revoked_at: string | null }>(
    `SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = @h`,
    { h: sha256(token) },
  );
  if (!row || row.revoked_at || row.expires_at < now())
    throw unauthorized('La sesión expiró. Inicia sesión de nuevo.');
  run(`UPDATE refresh_tokens SET revoked_at = @now WHERE id = @id`, { id: row.id, now: now() });
  return row.user_id;
}

export function revokeRefreshToken(token: string) {
  run(`UPDATE refresh_tokens SET revoked_at = @now WHERE token_hash = @h AND revoked_at IS NULL`, {
    h: sha256(token),
    now: now(),
  });
}

export function revokeAllRefreshTokens(userId: string) {
  run(`UPDATE refresh_tokens SET revoked_at = @now WHERE user_id = @uid AND revoked_at IS NULL`, {
    uid: userId,
    now: now(),
  });
}

/** Carga el usuario fresco desde la BD (permisos y estado siempre actualizados). */
export function loadAuthUser(userId: string): AuthUser | null {
  const u = get<any>(
    `SELECT u.*, c.is_platform,
       (SELECT s.status FROM subscriptions s WHERE s.company_id = u.company_id ORDER BY s.started_at DESC LIMIT 1) AS sub_status
     FROM users u JOIN companies c ON c.id = u.company_id
     WHERE u.id = @id AND u.deleted_at IS NULL`,
    { id: userId },
  );
  if (!u || !bool(u.active)) return null;
  return {
    id: u.id,
    companyId: u.company_id,
    name: u.name,
    email: u.email,
    role: u.role,
    permissions: effectivePermissions(u.role, parseJson(u.permissions, {})),
    isPlatform: bool(u.is_platform),
    subscriptionStatus: u.sub_status ?? null,
  };
}

export function authenticate(token: string | null | undefined): AuthUser {
  if (!token) throw unauthorized();
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { issuer: 'wms' }) as jwt.JwtPayload;
  } catch {
    throw unauthorized('Token inválido o expirado.');
  }
  const user = loadAuthUser(String(payload.sub));
  if (!user || user.companyId !== payload.cid) throw unauthorized('Usuario inactivo o inexistente.');
  return user;
}

export function requirePermission(user: AuthUser, module: Module, level: Level) {
  if (!can(user.permissions, module, level)) {
    throw forbidden(
      `Tu rol no tiene permiso de ${level === 'write' ? 'escritura' : 'lectura'} en «${module}».`,
    );
  }
  // Suscripción cancelada: sólo se permite el módulo de facturación para reactivar el plan (RG7).
  if (
    !user.isPlatform &&
    user.subscriptionStatus === 'canceled' &&
    module !== 'billing' &&
    level === 'write'
  ) {
    throw forbidden('La suscripción de tu empresa está cancelada. Reactívala en Suscripción y facturación.');
  }
}
