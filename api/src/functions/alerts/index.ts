import { badRequest } from '../../shared/errors';
import { created, defineHttp, noContent, ok, qInt } from '../../shared/http';
import { ALERT_TYPE_LABELS, alertsRepo, RuleInput } from '../../shared/repositories/alerts';
import { vehiclesRepo } from '../../shared/repositories/fleet';
import { email, parse, z } from '../../shared/validation';

const ruleType = z.enum([
  'geofence_enter',
  'geofence_exit',
  'prolonged_stop',
  'signal_loss',
  'route_deviation',
  'speeding',
  'theft',
  'low_battery',
]);
const ruleBody = z.object({
  name: z.string().trim().min(2).max(80),
  type: ruleType,
  threshold: z.number().min(0).max(100000).nullable().optional(),
  geofenceId: z.string().nullable().optional(),
  vehicleIds: z.array(z.string()).optional(),
  recipients: z.array(email).max(20).optional(),
  channels: z
    .array(z.enum(['inapp', 'email', 'push']))
    .min(1, 'Elige al menos un canal')
    .optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  active: z.boolean().optional(),
});

/** Coherencia entre tipo de regla y parámetros. */
function validateRule(r: Partial<RuleInput>) {
  const needsThreshold = ['prolonged_stop', 'signal_loss', 'speeding', 'low_battery'];
  if (r.type && needsThreshold.includes(r.type) && (r.threshold == null || r.threshold <= 0)) {
    throw badRequest('Este tipo de regla necesita un umbral mayor que cero.');
  }
  if (r.type === 'route_deviation' && !r.geofenceId)
    throw badRequest('El desvío de ruta necesita la geocerca/corredor de ruta autorizada.');
  if (r.channels?.includes('email') && !(r.recipients?.length ?? 0)) {
    throw badRequest('Agrega al menos un destinatario de correo o quita el canal correo.');
  }
}

defineHttp({
  name: 'alerts-meta',
  route: 'meta/alert-types',
  methods: ['GET'],
  guard: 'authenticated',
  handler: () => ok(Object.entries(ALERT_TYPE_LABELS).map(([id, label]) => ({ id, label }))),
});

/* Reglas – RF15 crear, RF17 actualizar, RF18 eliminar */
defineHttp({
  name: 'alert-rules-list',
  route: 'alert-rules',
  methods: ['GET'],
  guard: { module: 'alerts', level: 'read' },
  handler: (_req, ctx) => ok(alertsRepo.listRules(ctx.tenantId)),
});

defineHttp({
  name: 'alert-rules-create',
  route: 'alert-rules',
  methods: ['POST'],
  guard: { module: 'alerts', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(ruleBody, req.body);
    validateRule(body);
    return created(alertsRepo.createRule(ctx.tenantId, body));
  },
});

defineHttp({
  name: 'alert-rules-update',
  route: 'alert-rules/{id}',
  methods: ['PATCH'],
  guard: { module: 'alerts', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(ruleBody.partial(), req.body);
    const cur = alertsRepo.getRule(ctx.tenantId, req.params.id);
    validateRule({ ...cur, ...body });
    return ok(alertsRepo.updateRule(ctx.tenantId, req.params.id, body));
  },
});

defineHttp({
  name: 'alert-rules-delete',
  route: 'alert-rules/{id}',
  methods: ['DELETE'],
  guard: { module: 'alerts', level: 'write' },
  handler: (req, ctx) => {
    alertsRepo.removeRule(ctx.tenantId, req.params.id);
    return noContent();
  },
});

/* RF16 – Historial de alertas con filtros y paginación */
defineHttp({
  name: 'alerts-list',
  route: 'alerts',
  methods: ['GET'],
  guard: { module: 'alerts', level: 'read' },
  handler: (req, ctx) => {
    const q = req.query;
    let vehicleId = q.get('vehicleId') ?? undefined;
    if (ctx.user.role === 'driver') {
      vehicleId = vehiclesRepo.list(ctx.tenantId, { driverId: ctx.user.id })[0]?.id ?? '__none__';
    }
    const attended = q.get('attended');
    return ok(
      alertsRepo.list(ctx.tenantId, {
        type: q.get('type') ?? undefined,
        priority: q.get('priority') ?? undefined,
        vehicleId,
        attended: attended === null ? undefined : attended === 'true',
        from: q.get('from') ?? undefined,
        to: q.get('to') ?? undefined,
        limit: qInt(req, 'limit', 50, 1, 500),
        offset: qInt(req, 'offset', 0, 0, 1_000_000),
      }),
    );
  },
});

/* Marcar alerta como atendida */
defineHttp({
  name: 'alerts-attend',
  route: 'alerts/{id}/attend',
  methods: ['POST'],
  guard: { module: 'alerts', level: 'write' },
  handler: (req, ctx) => ok(alertsRepo.attend(ctx.tenantId, req.params.id, ctx.user.id)),
});

defineHttp({
  name: 'alerts-attend-all',
  route: 'alerts/attend-all',
  methods: ['POST'],
  guard: { module: 'alerts', level: 'write' },
  handler: (_req, ctx) => ok({ updated: alertsRepo.attendAll(ctx.tenantId, ctx.user.id) }),
});

/* Bandeja de notificaciones enviadas (correo / push simulados) */
defineHttp({
  name: 'notifications-list',
  route: 'notifications',
  methods: ['GET'],
  guard: { module: 'alerts', level: 'read' },
  handler: (req, ctx) => ok(alertsRepo.notifications(ctx.tenantId, qInt(req, 'limit', 100, 1, 500))),
});
