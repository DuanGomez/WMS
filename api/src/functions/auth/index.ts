import {
  consumeRefreshToken,
  issueRefreshToken,
  loadAuthUser,
  randomToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  sha256,
  signAccessToken,
  verifyPassword,
} from '../../shared/auth';
import { config } from '../../shared/config';
import { get, id, now, run } from '../../shared/db';
import { badRequest, unauthorized } from '../../shared/errors';
import { defineHttp, noContent, ok } from '../../shared/http';
import { MODULES, ROLE_LABELS } from '../../shared/permissions';
import { rateLimit, resetRateLimit } from '../../shared/ratelimit';
import { alertsRepo } from '../../shared/repositories/alerts';
import { usersRepo } from '../../shared/repositories/users';
import { email, parse, password, z } from '../../shared/validation';

/** Sesión que recibe el frontend: usuario, permisos efectivos y empresa. */
export function sessionPayload(userId: string) {
  const u = loadAuthUser(userId);
  if (!u) throw unauthorized();
  const row = get<any>(
    `SELECT u.phone, u.last_login_at, u.must_change_password, c.name AS company_name, c.is_platform,
       (SELECT p.name FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.company_id=c.id ORDER BY s.started_at DESC LIMIT 1) AS plan_name
     FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=@id`,
    { id: userId },
  );
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: row.phone,
    role: u.role,
    roleLabel: ROLE_LABELS[u.role],
    permissions: u.permissions,
    modules: MODULES,
    mustChangePassword: !!row.must_change_password,
    lastLoginAt: row.last_login_at,
    company: {
      id: u.companyId,
      name: row.company_name,
      isPlatform: u.isPlatform,
      planName: row.plan_name ?? null,
      subscriptionStatus: u.subscriptionStatus,
    },
  };
}

function tokens(user: { id: string; company_id: string; role: string }) {
  return {
    accessToken: signAccessToken(user),
    refreshToken: issueRefreshToken(user.id),
    tokenType: 'Bearer',
  };
}

/* RF13 – Iniciar sesión */
defineHttp({
  name: 'auth-login',
  route: 'auth/login',
  methods: ['POST'],
  guard: 'public',
  handler: async (req) => {
    const body = parse(z.object({ email, password: z.string().min(1, 'Ingresa tu contraseña') }), req.body);
    const key = `login:${req.ip}:${body.email}`;
    rateLimit(key, 8, 5 * 60_000);
    const user = usersRepo.findByEmail(body.email);
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      throw unauthorized('Correo o contraseña incorrectos.');
    }
    if (!user.active)
      throw unauthorized('Tu usuario está desactivado. Contacta al administrador de tu empresa.');
    resetRateLimit(key);
    usersRepo.touchLogin(user.id);
    return ok({ ...tokens(user), user: sessionPayload(user.id) });
  },
});

/* Renovación de tokens (refresh token rotativo) */
defineHttp({
  name: 'auth-refresh',
  route: 'auth/refresh',
  methods: ['POST'],
  guard: 'public',
  handler: (req) => {
    const body = parse(z.object({ refreshToken: z.string().min(10) }), req.body);
    const userId = consumeRefreshToken(body.refreshToken);
    const user = get<any>(
      `SELECT id, company_id, role, active FROM users WHERE id=@id AND deleted_at IS NULL`,
      { id: userId },
    );
    if (!user || !user.active) throw unauthorized();
    return ok({ ...tokens(user), user: sessionPayload(user.id) });
  },
});

/* RF14 – Cerrar sesión: invalida el refresh token */
defineHttp({
  name: 'auth-logout',
  route: 'auth/logout',
  methods: ['POST'],
  guard: 'public',
  handler: (req) => {
    const body = parse(
      z.object({ refreshToken: z.string().optional(), allDevices: z.boolean().optional() }),
      req.body,
    );
    if (body.refreshToken) {
      const row = get<any>(`SELECT user_id FROM refresh_tokens WHERE token_hash=@h`, {
        h: sha256(body.refreshToken),
      });
      revokeRefreshToken(body.refreshToken);
      if (body.allDevices && row) revokeAllRefreshTokens(row.user_id);
    }
    return noContent();
  },
});

defineHttp({
  name: 'auth-me',
  route: 'auth/me',
  methods: ['GET'],
  guard: 'authenticated',
  handler: (_req, ctx) => ok(sessionPayload(ctx.user.id)),
});

defineHttp({
  name: 'auth-me-update',
  route: 'auth/me',
  methods: ['PATCH'],
  guard: 'authenticated',
  handler: (req, ctx) => {
    const body = parse(
      z.object({ name: z.string().trim().min(2).max(80).optional(), phone: z.string().max(30).optional() }),
      req.body,
    );
    usersRepo.update(ctx.tenantId, ctx.user.id, body);
    return ok(sessionPayload(ctx.user.id));
  },
});

/* RF27 – Cambiar contraseña (con la actual) */
defineHttp({
  name: 'auth-change-password',
  route: 'auth/change-password',
  methods: ['POST'],
  guard: 'authenticated',
  handler: async (req, ctx) => {
    const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: password }), req.body);
    const u = get<any>(`SELECT * FROM users WHERE id=@id`, { id: ctx.user.id });
    if (!(await verifyPassword(body.currentPassword, u.password_hash)))
      throw badRequest('La contraseña actual no es correcta.');
    if (body.currentPassword === body.newPassword)
      throw badRequest('La nueva contraseña debe ser diferente a la actual.');
    await usersRepo.setPassword(u.id, body.newPassword);
    revokeAllRefreshTokens(u.id);
    return ok({ ...tokens(u), user: sessionPayload(u.id) });
  },
});

/* RF27 – Recuperar contraseña olvidada: genera enlace (el correo se simula en la bandeja de notificaciones) */
defineHttp({
  name: 'auth-forgot-password',
  route: 'auth/forgot-password',
  methods: ['POST'],
  guard: 'public',
  handler: (req) => {
    const body = parse(z.object({ email }), req.body);
    rateLimit(`forgot:${req.ip}`, 5, 10 * 60_000);
    const user = usersRepo.findByEmail(body.email);
    const generic = {
      message: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.',
    };
    if (!user || !user.active) return ok(generic);
    const token = randomToken(32);
    run(
      `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (@id,@uid,@h,@exp,@ts)`,
      {
        id: id(),
        uid: user.id,
        h: sha256(token),
        exp: new Date(Date.now() + 30 * 60_000).toISOString(),
        ts: now(),
      },
    );
    const resetPath = `/restablecer?token=${token}`;
    alertsRepo.insertNotification(user.company_id, {
      channel: 'email',
      recipient: user.email,
      subject: '[WMS] Restablece tu contraseña',
      body: `Hola ${user.name}, usa este enlace (válido 30 min) para crear una nueva contraseña: ${resetPath}`,
    });
    console.log(
      JSON.stringify({ level: 'info', msg: 'email simulado: recuperación de contraseña', to: user.email }),
    );
    // En modo demo devolvemos el enlace para poder probar el flujo sin un servidor de correo real.
    return ok(config.demoMode ? { ...generic, demoResetPath: resetPath } : generic);
  },
});

defineHttp({
  name: 'auth-reset-password',
  route: 'auth/reset-password',
  methods: ['POST'],
  guard: 'public',
  handler: async (req) => {
    const body = parse(z.object({ token: z.string().min(10), newPassword: password }), req.body);
    const row = get<any>(`SELECT * FROM password_resets WHERE token_hash=@h`, { h: sha256(body.token) });
    if (!row || row.used_at || row.expires_at < now())
      throw badRequest('El enlace no es válido o ya expiró. Solicita uno nuevo.');
    await usersRepo.setPassword(row.user_id, body.newPassword);
    run(`UPDATE password_resets SET used_at=@ts WHERE id=@id`, { ts: now(), id: row.id });
    revokeAllRefreshTokens(row.user_id);
    return ok({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  },
});
