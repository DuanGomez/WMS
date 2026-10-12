import { randomToken } from '../../shared/auth';
import { run } from '../../shared/db';
import { badRequest, forbidden } from '../../shared/errors';
import { Ctx, created, defineHttp, noContent, ok } from '../../shared/http';
import {
  MODULES,
  PermissionMap,
  ROLE_DEFAULTS,
  ROLE_LABELS,
  Role,
  TENANT_ROLES,
} from '../../shared/permissions';
import { companiesRepo } from '../../shared/repositories/companies';
import { driversRepo, usersRepo } from '../../shared/repositories/users';
import { email, parse, password, z } from '../../shared/validation';

const role = z.enum(['admin', 'owner', 'supervisor', 'driver']);
const level = z.enum(['none', 'read', 'write']);
const permissionsSchema = z.partialRecord(z.enum(MODULES), level);

function assertRoleAllowed(ctx: Ctx, target: Role) {
  if (target === 'owner' && ctx.user.role !== 'owner') {
    throw forbidden('Sólo el responsable de la empresa puede asignar el rol «Responsable de empresa».');
  }
}

/* Catálogo de roles y módulos para la UI de permisos */
defineHttp({
  name: 'users-meta',
  route: 'meta/permissions',
  methods: ['GET'],
  guard: 'authenticated',
  handler: () =>
    ok({
      modules: MODULES,
      roles: TENANT_ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r], defaults: ROLE_DEFAULTS[r] })),
    }),
});

/* RF10 – Listar usuarios y permisos */
defineHttp({
  name: 'users-list',
  route: 'users',
  methods: ['GET'],
  guard: { module: 'users', level: 'read' },
  handler: (req, ctx) =>
    ok(
      usersRepo.list(ctx.tenantId, {
        role: req.query.get('role') ?? undefined,
        q: req.query.get('q') ?? undefined,
      }),
    ),
});

defineHttp({
  name: 'users-get',
  route: 'users/{id}',
  methods: ['GET'],
  guard: { module: 'users', level: 'read' },
  handler: (req, ctx) => ok(usersRepo.get(ctx.tenantId, req.params.id)),
});

/* RF9 – Crear usuario con rol */
defineHttp({
  name: 'users-create',
  route: 'users',
  methods: ['POST'],
  guard: { module: 'users', level: 'write' },
  handler: async (req, ctx) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(80),
        email,
        role,
        password,
        phone: z.string().max(30).optional(),
        permissions: permissionsSchema.optional(),
      }),
      req.body,
    );
    assertRoleAllowed(ctx, body.role);
    companiesRepo.assertCanAdd(ctx.tenantId, 'users');
    const user = await usersRepo.create(ctx.tenantId, body);
    if (body.role === 'driver') driversRepo.upsertProfile(ctx.tenantId, user.id, {});
    return created(user);
  },
});

/* RF11 – Actualizar datos o rol */
defineHttp({
  name: 'users-update',
  route: 'users/{id}',
  methods: ['PATCH'],
  guard: { module: 'users', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(80).optional(),
        email: email.optional(),
        role: role.optional(),
        phone: z.string().max(30).optional(),
        active: z.boolean().optional(),
      }),
      req.body,
    );
    const target = usersRepo.get(ctx.tenantId, req.params.id);
    if (body.role) assertRoleAllowed(ctx, body.role);
    if (target.role === 'owner' && ctx.user.role !== 'owner')
      throw forbidden('No puedes modificar al responsable de la empresa.');
    if (
      req.params.id === ctx.user.id &&
      (body.active === false || (body.role && body.role !== target.role))
    ) {
      throw badRequest('No puedes desactivarte ni cambiar tu propio rol.');
    }
    const updated = usersRepo.update(ctx.tenantId, req.params.id, body);
    if (updated.role === 'driver') driversRepo.upsertProfile(ctx.tenantId, updated.id, {});
    if (target.role === 'driver' && updated.role !== 'driver') {
      run(`UPDATE vehicles SET driver_id=NULL WHERE driver_id=@id AND company_id=@cid`, {
        id: updated.id,
        cid: ctx.tenantId,
      });
    }
    return ok(updated);
  },
});

/* RF32 – Permisos granulares por módulo */
defineHttp({
  name: 'users-permissions',
  route: 'users/{id}/permissions',
  methods: ['PUT'],
  guard: { module: 'users', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(z.object({ permissions: permissionsSchema }), req.body);
    const target = usersRepo.get(ctx.tenantId, req.params.id);
    if (target.role === 'owner') throw badRequest('El responsable de la empresa siempre tiene acceso total.');
    if (req.params.id === ctx.user.id) throw badRequest('No puedes modificar tus propios permisos.');
    // Sólo se guardan las diferencias con el rol (así un cambio de rol sigue funcionando como se espera).
    const defaults = ROLE_DEFAULTS[target.role];
    const overrides: Partial<PermissionMap> = {};
    for (const m of MODULES) {
      const v = body.permissions[m];
      if (v && v !== defaults[m]) overrides[m] = v;
    }
    return ok(usersRepo.setPermissions(ctx.tenantId, req.params.id, overrides));
  },
});

/* Restablecer contraseña de otro usuario (genera una temporal) */
defineHttp({
  name: 'users-reset-password',
  route: 'users/{id}/reset-password',
  methods: ['POST'],
  guard: { module: 'users', level: 'write' },
  handler: async (req, ctx) => {
    const target = usersRepo.get(ctx.tenantId, req.params.id);
    if (target.role === 'owner' && ctx.user.role !== 'owner') throw forbidden();
    const temp = `Wms-${randomToken(6)}1`;
    await usersRepo.setPassword(target.id, temp);
    run(`UPDATE users SET must_change_password=1 WHERE id=@id`, { id: target.id });
    return ok({ temporaryPassword: temp });
  },
});

/* RF12 – Eliminar (desactivar) */
defineHttp({
  name: 'users-delete',
  route: 'users/{id}',
  methods: ['DELETE'],
  guard: { module: 'users', level: 'write' },
  handler: (req, ctx) => {
    if (req.params.id === ctx.user.id) throw badRequest('No puedes eliminar tu propio usuario.');
    const target = usersRepo.get(ctx.tenantId, req.params.id);
    if (target.role === 'owner') throw forbidden('El responsable de la empresa no se puede eliminar.');
    usersRepo.remove(ctx.tenantId, req.params.id);
    return noContent();
  },
});
