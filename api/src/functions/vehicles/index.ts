import { forbidden } from '../../shared/errors';
import { Ctx, created, defineHttp, noContent, ok } from '../../shared/http';
import { vehiclesRepo } from '../../shared/repositories/fleet';
import { trackingRepo } from '../../shared/repositories/tracking';
import { isoDate, parse, z } from '../../shared/validation';

const vehicleType = z.enum(['moto', 'carro', 'camion', 'furgon']);
const plate = z
  .string()
  .trim()
  .min(5, 'Placa inválida')
  .max(8, 'Placa inválida')
  .regex(/^[A-Za-z]{3}\s?-?\d{2}[A-Za-z0-9]$/, 'Formato de placa colombiana: ABC123 o ABC12D')
  .transform((v) => v.replace(/[\s-]/g, '').toUpperCase());

const vehicleBody = z.object({
  plate,
  type: vehicleType,
  brand: z.string().trim().max(40).optional(),
  model: z.string().trim().max(40).optional(),
  year: z.number().int().min(1980).max(2030).nullable().optional(),
  color: z.string().trim().max(30).optional(),
  status: z.enum(['active', 'maintenance', 'inactive']).optional(),
  deviceId: z.string().nullable().optional(),
  driverId: z.string().nullable().optional(),
});

/** Los conductores sólo ven su propio vehículo. */
function assertVehicleAccess(ctx: Ctx, vehicleId: string) {
  const v = vehiclesRepo.get(ctx.tenantId, vehicleId);
  if (ctx.user.role === 'driver' && v.driver?.id !== ctx.user.id)
    throw forbidden('Sólo puedes ver el vehículo que tienes asignado.');
  return v;
}

/* RF2 – Consultar vehículos con su ubicación */
defineHttp({
  name: 'vehicles-list',
  route: 'vehicles',
  methods: ['GET'],
  guard: { module: 'vehicles', level: 'read' },
  handler: (req, ctx) =>
    ok(
      vehiclesRepo.list(ctx.tenantId, {
        includeRetired: req.query.get('includeRetired') === 'true',
        q: req.query.get('q') ?? undefined,
        type: req.query.get('type') ?? undefined,
        driverId: ctx.user.role === 'driver' ? ctx.user.id : undefined,
      }),
    ),
});

defineHttp({
  name: 'vehicles-get',
  route: 'vehicles/{id}',
  methods: ['GET'],
  guard: { module: 'vehicles', level: 'read' },
  handler: (req, ctx) => ok(assertVehicleAccess(ctx, req.params.id)),
});

/* RF1 – Crear vehículo (respeta el límite del plan) */
defineHttp({
  name: 'vehicles-create',
  route: 'vehicles',
  methods: ['POST'],
  guard: { module: 'vehicles', level: 'write' },
  handler: (req, ctx) => created(vehiclesRepo.create(ctx.tenantId, parse(vehicleBody, req.body))),
});

/* RF3 – Actualizar tipo, estado, conductor o dispositivo */
defineHttp({
  name: 'vehicles-update',
  route: 'vehicles/{id}',
  methods: ['PATCH'],
  guard: { module: 'vehicles', level: 'write' },
  handler: (req, ctx) =>
    ok(vehiclesRepo.update(ctx.tenantId, req.params.id, parse(vehicleBody.partial(), req.body))),
});

/* RF4 – Dar de baja */
defineHttp({
  name: 'vehicles-delete',
  route: 'vehicles/{id}',
  methods: ['DELETE'],
  guard: { module: 'vehicles', level: 'write' },
  handler: (req, ctx) => {
    const reason = req.query.get('reason') || 'Dado de baja por el administrador';
    vehiclesRepo.retire(ctx.tenantId, req.params.id, reason.slice(0, 200));
    return noContent();
  },
});

/* Histórico de posiciones (reproducción de recorrido / playback) */
defineHttp({
  name: 'vehicles-positions',
  route: 'vehicles/{id}/positions',
  methods: ['GET'],
  guard: { module: 'vehicles', level: 'read' },
  handler: (req, ctx) => {
    assertVehicleAccess(ctx, req.params.id);
    const q = parse(z.object({ from: isoDate, to: isoDate }), Object.fromEntries(req.query.entries()));
    return ok(
      trackingRepo.positionsRange(
        ctx.tenantId,
        req.params.id,
        new Date(q.from).toISOString(),
        new Date(q.to).toISOString(),
      ),
    );
  },
});

/* Recorridos de un vehículo */
defineHttp({
  name: 'vehicles-trips',
  route: 'vehicles/{id}/trips',
  methods: ['GET'],
  guard: { module: 'vehicles', level: 'read' },
  handler: (req, ctx) => {
    assertVehicleAccess(ctx, req.params.id);
    return ok(
      trackingRepo.trips(ctx.tenantId, {
        vehicleId: req.params.id,
        from: req.query.get('from') ?? undefined,
        to: req.query.get('to') ?? undefined,
        limit: 100,
      }),
    );
  },
});

/* Trayecto completo de un recorrido */
defineHttp({
  name: 'trips-positions',
  route: 'trips/{id}/positions',
  methods: ['GET'],
  guard: { module: 'vehicles', level: 'read' },
  handler: (req, ctx) => {
    const trip = trackingRepo.trip(ctx.tenantId, req.params.id);
    if (!trip) return { status: 404, json: { code: 'NOT_FOUND', message: 'Recorrido no encontrado.' } };
    assertVehicleAccess(ctx, trip.vehicleId);
    return ok({ trip, positions: trackingRepo.tripPositions(ctx.tenantId, req.params.id) });
  },
});
