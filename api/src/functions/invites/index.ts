/**
 * Invitaciones de conductores: el administrador genera un enlace (o código QR) y cada persona se registra sola
 * desde su celular como conductor de la empresa. Al entrar, «Mi turno» le pide compartir su ubicación y el
 * administrador la ve en el mapa en tiempo real (pensado para demostraciones en vivo, p. ej. una exposición).
 */
import { issueRefreshToken, signAccessToken } from '../../shared/auth';
import { all, get, id, now, run, tx } from '../../shared/db';
import { ApiError, notFound } from '../../shared/errors';
import { created, defineHttp, noContent, ok } from '../../shared/http';
import { rateLimit } from '../../shared/ratelimit';
import { companiesRepo } from '../../shared/repositories/companies';
import { driversRepo, usersRepo } from '../../shared/repositories/users';
import { email, parse, password, z } from '../../shared/validation';
import { sessionPayload } from '../auth';

/** Sin caracteres que se confunden al dictarlos o leerlos (0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export interface InviteDto {
  id: string;
  code: string;
  label: string;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  active: boolean;
  /** Vigente: activa, sin vencer y con cupos. */
  valid: boolean;
}

const mapInvite = (r: any): InviteDto => {
  const expired = !!r.expires_at && Date.parse(r.expires_at) <= Date.now();
  const full = r.max_uses != null && Number(r.uses) >= Number(r.max_uses);
  return {
    id: r.id,
    code: r.code,
    label: r.label,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    maxUses: r.max_uses == null ? null : Number(r.max_uses),
    uses: Number(r.uses),
    active: r.active === 1 || r.active === true,
    valid: (r.active === 1 || r.active === true) && !expired && !full,
  };
};

const normalizeCode = (c: string) => c.replace(/[\s-]/g, '').toUpperCase();

async function findValid(code: string) {
  const r = await get<any>(
    `SELECT i.*, c.name AS company_name FROM driver_invites i JOIN companies c ON c.id = i.company_id WHERE i.code=@code`,
    { code: normalizeCode(code) },
  );
  if (!r || !mapInvite(r).valid) throw notFound('Invitación vigente');
  return r;
}

defineHttp({
  name: 'invites-list',
  route: 'invites',
  methods: ['GET'],
  guard: { module: 'drivers', level: 'read' },
  handler: async (_req, ctx) =>
    ok(
      (
        await all(`SELECT * FROM driver_invites WHERE company_id=@cid ORDER BY active DESC, created_at DESC`, {
          cid: ctx.tenantId,
        })
      ).map(mapInvite),
    ),
});

defineHttp({
  name: 'invites-create',
  route: 'invites',
  methods: ['POST'],
  guard: { module: 'drivers', level: 'write' },
  handler: async (req, ctx) => {
    const b = parse(
      z.object({
        label: z.string().trim().max(60).default(''),
        expiresInHours: z.number().int().min(1).max(24 * 30).nullable().default(72),
        maxUses: z.number().int().min(1).max(500).nullable().default(null),
      }),
      req.body,
    );
    const inviteId = id();
    let code = newCode();
    while (await get('SELECT 1 AS x FROM driver_invites WHERE code=@code', { code })) code = newCode();
    await run(
      `INSERT INTO driver_invites (id, company_id, code, label, created_by, created_at, expires_at, max_uses)
       VALUES (@id,@cid,@code,@label,@by,@ts,@exp,@max)`,
      {
        id: inviteId,
        cid: ctx.tenantId,
        code,
        label: b.label,
        by: ctx.user.id,
        ts: now(),
        exp: b.expiresInHours ? new Date(Date.now() + b.expiresInHours * 3_600_000).toISOString() : null,
        max: b.maxUses,
      },
    );
    return created(mapInvite(await get(`SELECT * FROM driver_invites WHERE id=@id`, { id: inviteId })));
  },
});

defineHttp({
  name: 'invites-revoke',
  route: 'invites/{id}',
  methods: ['DELETE'],
  guard: { module: 'drivers', level: 'write' },
  handler: async (req, ctx) => {
    const r = await run(`UPDATE driver_invites SET active=0 WHERE id=@id AND company_id=@cid`, {
      id: req.params.id,
      cid: ctx.tenantId,
    });
    if (!r.changes) throw notFound('Invitación');
    return noContent();
  },
});

/* Público: datos para la pantalla «Únete como conductor». */
defineHttp({
  name: 'join-info',
  route: 'join/{code}',
  methods: ['GET'],
  guard: 'public',
  handler: async (req) => {
    const r = await findValid(req.params.code);
    return ok({ code: r.code, company: r.company_name, label: r.label, expiresAt: r.expires_at });
  },
});

/* Público: la persona crea su cuenta de conductor y entra de una vez (devuelve la sesión). */
defineHttp({
  name: 'join',
  route: 'join/{code}',
  methods: ['POST'],
  guard: 'public',
  handler: async (req) => {
    const b = parse(
      z.object({
        name: z.string().trim().min(2).max(80),
        email,
        phone: z.string().trim().min(7, 'Teléfono inválido').max(30),
        password,
      }),
      req.body,
    );
    // Por IP y correo: en una exposición todos comparten la IP pública de la red de la universidad.
    rateLimit(`join:${req.ip}:${b.email}`, 6, 10 * 60_000);
    const invite = await findValid(req.params.code);
    const user = await tx(async () => {
      const taken = await run(
        `UPDATE driver_invites SET uses = uses + 1
         WHERE id=@id AND active=1 AND (max_uses IS NULL OR uses < max_uses)`,
        { id: invite.id },
      );
      if (!taken.changes) throw new ApiError(410, 'INVITE_FULL', 'Esta invitación ya alcanzó su cupo.');
      await companiesRepo.assertCanAdd(invite.company_id, 'users');
      const u = await usersRepo.create(invite.company_id, { name: b.name, email: b.email, phone: b.phone, password: b.password, role: 'driver' });
      await driversRepo.upsertProfile(invite.company_id, u.id, {});
      return u;
    });
    await usersRepo.touchLogin(user.id);
    return created({
      accessToken: signAccessToken({ id: user.id, company_id: invite.company_id, role: 'driver' }),
      refreshToken: await issueRefreshToken(user.id),
      tokenType: 'Bearer',
      user: await sessionPayload(user.id),
    });
  },
});
