import { issueRefreshToken, signAccessToken } from '../../shared/auth';
import { conflict } from '../../shared/errors';
import { created, defineHttp, ok } from '../../shared/http';
import { companiesRepo, plansRepo } from '../../shared/repositories/companies';
import { usersRepo } from '../../shared/repositories/users';
import { email, parse, password, z } from '../../shared/validation';
import { sessionPayload } from '../auth';

const planCode = z.enum(['basico', 'pro', 'flota']);

/* Catálogo público de planes */
defineHttp({
  name: 'plans-list',
  route: 'plans',
  methods: ['GET'],
  guard: 'public',
  handler: () => ok(plansRepo.list()),
});

/* RF23 – Registro self-service de una nueva empresa con su plan (HU7) */
defineHttp({
  name: 'companies-signup',
  route: 'companies/signup',
  methods: ['POST'],
  guard: 'public',
  handler: async (req) => {
    const body = parse(
      z.object({
        company: z.object({
          name: z.string().trim().min(2).max(100),
          nit: z
            .string()
            .trim()
            .regex(/^\d{6,10}(-\d)?$/, 'NIT inválido (ej. 900123456-7)'),
          email,
          phone: z.string().trim().min(7).max(30),
          city: z.string().trim().min(2).max(60).default('Medellín'),
        }),
        owner: z.object({ name: z.string().trim().min(2).max(80), email, password }),
        planCode,
      }),
      req.body,
    );
    if (usersRepo.findByEmail(body.owner.email)) throw conflict('Ya existe un usuario con ese correo.');
    const companyId = companiesRepo.createWithPlan({ ...body.company, planCode: body.planCode });
    const owner = await usersRepo.create(companyId, {
      ...body.owner,
      role: 'owner',
      phone: body.company.phone,
    });
    return created({
      accessToken: signAccessToken({ id: owner.id, company_id: companyId, role: 'owner' }),
      refreshToken: issueRefreshToken(owner.id),
      tokenType: 'Bearer',
      user: sessionPayload(owner.id),
    });
  },
});

defineHttp({
  name: 'company-get',
  route: 'company',
  methods: ['GET'],
  guard: { module: 'billing', level: 'read' },
  handler: (_req, ctx) => ok(companiesRepo.get(ctx.tenantId)),
});

defineHttp({
  name: 'company-update',
  route: 'company',
  methods: ['PATCH'],
  guard: { module: 'billing', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(100).optional(),
        nit: z.string().trim().max(20).optional(),
        email: email.optional(),
        phone: z.string().max(30).optional(),
        city: z.string().max(60).optional(),
        address: z.string().max(120).optional(),
      }),
      req.body,
    );
    return ok(companiesRepo.update(ctx.tenantId, body));
  },
});

/* RF24 – Estado de la suscripción, plan y uso */
defineHttp({
  name: 'subscription-get',
  route: 'subscription',
  methods: ['GET'],
  guard: { module: 'billing', level: 'read' },
  handler: (_req, ctx) => ok(companiesRepo.subscription(ctx.tenantId)),
});

/* RF25 – Cambiar plan (también reactiva una suscripción cancelada) */
defineHttp({
  name: 'subscription-change-plan',
  route: 'subscription/plan',
  methods: ['PUT'],
  guard: { module: 'billing', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(z.object({ planCode }), req.body);
    return ok(companiesRepo.changePlan(ctx.tenantId, body.planCode));
  },
});

/* RF26 – Cancelar suscripción */
defineHttp({
  name: 'subscription-cancel',
  route: 'subscription/cancel',
  methods: ['POST'],
  guard: { module: 'billing', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(
      z.object({ reason: z.string().trim().min(3, 'Cuéntanos el motivo').max(300) }),
      req.body,
    );
    return ok(companiesRepo.cancel(ctx.tenantId, body.reason));
  },
});

/* Facturación (RE9) */
defineHttp({
  name: 'invoices-list',
  route: 'invoices',
  methods: ['GET'],
  guard: { module: 'billing', level: 'read' },
  handler: (_req, ctx) => ok(companiesRepo.invoices(ctx.tenantId)),
});

defineHttp({
  name: 'invoices-pay',
  route: 'invoices/{id}/pay',
  methods: ['POST'],
  guard: { module: 'billing', level: 'write' },
  handler: (req, ctx) => ok(companiesRepo.payInvoice(ctx.tenantId, req.params.id)),
});
