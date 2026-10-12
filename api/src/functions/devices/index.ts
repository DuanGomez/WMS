import { created, defineHttp, noContent, ok } from '../../shared/http';
import { devicesRepo } from '../../shared/repositories/fleet';
import { parse, z } from '../../shared/validation';

/* RF29 – Listar dispositivos con estado y vehículo asociado */
defineHttp({
  name: 'devices-list',
  route: 'devices',
  methods: ['GET'],
  guard: { module: 'devices', level: 'read' },
  handler: (req, ctx) =>
    ok(
      devicesRepo.list(ctx.tenantId, {
        includeRetired: req.query.get('includeRetired') === 'true',
        status: req.query.get('status') ?? undefined,
      }),
    ),
});

defineHttp({
  name: 'devices-get',
  route: 'devices/{id}',
  methods: ['GET'],
  guard: { module: 'devices', level: 'read' },
  handler: (req, ctx) =>
    ok(devicesRepo.get(ctx.tenantId, req.params.id, ctx.user.permissions.devices === 'write')),
});

/* RF28 – Registrar dispositivo independientemente del vehículo (devuelve la API key una vez) */
defineHttp({
  name: 'devices-create',
  route: 'devices',
  methods: ['POST'],
  guard: { module: 'devices', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(
      z.object({
        serial: z.string().trim().min(4, 'Serial/IMEI inválido').max(40),
        model: z.string().trim().min(2).max(60),
        notes: z.string().max(300).optional(),
        status: z.enum(['active', 'inactive']).optional(),
      }),
      req.body,
    );
    return created(devicesRepo.create(ctx.tenantId, body));
  },
});

/* RF30 – Reasignar a otro vehículo o actualizar estado */
defineHttp({
  name: 'devices-update',
  route: 'devices/{id}',
  methods: ['PATCH'],
  guard: { module: 'devices', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(
      z.object({
        model: z.string().trim().min(2).max(60).optional(),
        notes: z.string().max(300).optional(),
        status: z.enum(['active', 'inactive', 'faulty']).optional(),
        vehicleId: z.string().nullable().optional(),
      }),
      req.body,
    );
    return ok(devicesRepo.update(ctx.tenantId, req.params.id, body));
  },
});

defineHttp({
  name: 'devices-regenerate-key',
  route: 'devices/{id}/regenerate-key',
  methods: ['POST'],
  guard: { module: 'devices', level: 'write' },
  handler: (req, ctx) => ok(devicesRepo.regenerateKey(ctx.tenantId, req.params.id)),
});

/* RF31 – Eliminar (dar de baja) por robo, daño o fin de vida útil */
defineHttp({
  name: 'devices-delete',
  route: 'devices/{id}',
  methods: ['DELETE'],
  guard: { module: 'devices', level: 'write' },
  handler: (req, ctx) => {
    const reason = parse(
      z.enum(['robado', 'dañado', 'fin_vida_util', 'otro']),
      req.query.get('reason') ?? 'otro',
    );
    devicesRepo.retire(ctx.tenantId, req.params.id, reason);
    return noContent();
  },
});
