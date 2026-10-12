import { fireAlert } from '../../shared/alert-engine';
import { now } from '../../shared/db';
import { badRequest, notFound } from '../../shared/errors';
import { created, defineHttp, noContent, ok } from '../../shared/http';
import { companiesRepo } from '../../shared/repositories/companies';
import { vehiclesRepo } from '../../shared/repositories/fleet';
import { trackingRepo } from '../../shared/repositories/tracking';
import { driversRepo, usersRepo } from '../../shared/repositories/users';
import { email, parse, password, z } from '../../shared/validation';

const profile = z.object({
  document: z.string().trim().max(20).optional(),
  licenseNumber: z.string().trim().max(30).optional(),
  licenseCategory: z.enum(['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3']).optional(),
  licenseExpiresAt: z.string().nullable().optional(),
  status: z.enum(['disponible', 'en_ruta', 'descanso', 'inactivo']).optional(),
});

/* RE7 – Listar conductores con su vehículo asignado */
defineHttp({
  name: 'drivers-list',
  route: 'drivers',
  methods: ['GET'],
  guard: { module: 'drivers', level: 'read' },
  handler: (_req, ctx) => ok(driversRepo.list(ctx.tenantId)),
});

defineHttp({
  name: 'drivers-get',
  route: 'drivers/{id}',
  methods: ['GET'],
  guard: { module: 'drivers', level: 'read' },
  handler: (req, ctx) => ok(driversRepo.get(ctx.tenantId, req.params.id)),
});

/* RE7 – Registrar conductor (Conductor hereda de Usuario: crea usuario con rol driver + perfil) */
defineHttp({
  name: 'drivers-create',
  route: 'drivers',
  methods: ['POST'],
  guard: { module: 'drivers', level: 'write' },
  handler: async (req, ctx) => {
    const body = parse(
      profile.extend({
        name: z.string().trim().min(2).max(80),
        email,
        phone: z.string().trim().min(7, 'Teléfono inválido').max(30),
        password,
        vehicleId: z.string().nullable().optional(),
      }),
      req.body,
    );
    companiesRepo.assertCanAdd(ctx.tenantId, 'users');
    const user = await usersRepo.create(ctx.tenantId, {
      name: body.name,
      email: body.email,
      phone: body.phone,
      password: body.password,
      role: 'driver',
    });
    driversRepo.upsertProfile(ctx.tenantId, user.id, body);
    if (body.vehicleId) driversRepo.assignVehicle(ctx.tenantId, user.id, body.vehicleId);
    return created(driversRepo.get(ctx.tenantId, user.id));
  },
});

defineHttp({
  name: 'drivers-update',
  route: 'drivers/{id}',
  methods: ['PATCH'],
  guard: { module: 'drivers', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(
      profile.extend({
        name: z.string().trim().min(2).max(80).optional(),
        phone: z.string().max(30).optional(),
        active: z.boolean().optional(),
      }),
      req.body,
    );
    driversRepo.get(ctx.tenantId, req.params.id);
    usersRepo.update(ctx.tenantId, req.params.id, {
      name: body.name,
      phone: body.phone,
      active: body.active,
    });
    driversRepo.upsertProfile(ctx.tenantId, req.params.id, body);
    return ok(driversRepo.get(ctx.tenantId, req.params.id));
  },
});

/* RE7 – Asociar / liberar vehículo */
defineHttp({
  name: 'drivers-assign',
  route: 'drivers/{id}/vehicle',
  methods: ['PUT'],
  guard: { module: 'drivers', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(z.object({ vehicleId: z.string().nullable() }), req.body);
    return ok(driversRepo.assignVehicle(ctx.tenantId, req.params.id, body.vehicleId));
  },
});

defineHttp({
  name: 'drivers-delete',
  route: 'drivers/{id}',
  methods: ['DELETE'],
  guard: { module: 'drivers', level: 'write' },
  handler: (req, ctx) => {
    driversRepo.get(ctx.tenantId, req.params.id);
    usersRepo.remove(ctx.tenantId, req.params.id);
    return noContent();
  },
});

/* ---- Acciones del propio conductor (modelo de dominio: iniciarRecorrido, finalizarRecorrido, enviarAlertaEmergencia) ---- */

function myVehicle(tenantId: string, userId: string) {
  const v = vehiclesRepo.list(tenantId, { driverId: userId })[0];
  if (!v) throw notFound('Vehículo asignado');
  return v;
}

defineHttp({
  name: 'me-driver',
  route: 'me/driver',
  methods: ['GET'],
  guard: { roles: ['driver'] },
  handler: (_req, ctx) => {
    const d = driversRepo.get(ctx.tenantId, ctx.user.id);
    const trips = trackingRepo.trips(ctx.tenantId, { driverId: ctx.user.id, limit: 10 });
    return ok({ driver: d, vehicle: d.vehicle ? vehiclesRepo.get(ctx.tenantId, d.vehicle.id) : null, trips });
  },
});

defineHttp({
  name: 'me-trip-start',
  route: 'me/trip/start',
  methods: ['POST'],
  guard: { roles: ['driver'] },
  handler: (_req, ctx) => {
    const v = myVehicle(ctx.tenantId, ctx.user.id);
    const open = trackingRepo.openTrip(v.id);
    if (open) trackingRepo.closeTrip(open.id, now());
    const tripId = trackingRepo.startTrip(ctx.tenantId, v.id, ctx.user.id, now());
    driversRepo.setShift(ctx.tenantId, ctx.user.id, true);
    return ok({ tripId, vehicleId: v.id });
  },
});

defineHttp({
  name: 'me-trip-finish',
  route: 'me/trip/finish',
  methods: ['POST'],
  guard: { roles: ['driver'] },
  handler: (_req, ctx) => {
    const v = myVehicle(ctx.tenantId, ctx.user.id);
    const open = trackingRepo.openTrip(v.id);
    if (!open) throw badRequest('No tienes un recorrido en curso.');
    trackingRepo.closeTrip(open.id, now());
    driversRepo.setShift(ctx.tenantId, ctx.user.id, false);
    return ok(trackingRepo.trip(ctx.tenantId, open.id));
  },
});

defineHttp({
  name: 'me-emergency',
  route: 'me/emergency',
  methods: ['POST'],
  guard: { roles: ['driver'] },
  handler: (req, ctx) => {
    const body = parse(z.object({ message: z.string().max(300).optional() }), req.body);
    const v = myVehicle(ctx.tenantId, ctx.user.id);
    const alert = fireAlert(
      ctx.tenantId,
      { id: '', name: 'Botón de emergencia', channels: ['inapp', 'push'], recipients: [] },
      {
        type: 'emergency',
        priority: 'critical',
        vehicleId: v.id,
        deviceId: v.device?.id ?? null,
        lat: v.live?.lat ?? null,
        lng: v.live?.lng ?? null,
        title: `🚨 Emergencia: ${ctx.user.name} (${v.plate})`,
        description:
          body.message?.trim() ||
          `El conductor ${ctx.user.name} activó el botón de emergencia desde el vehículo ${v.plate}.`,
      },
    );
    return created(alert);
  },
});
