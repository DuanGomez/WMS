import { badRequest } from '../../shared/errors';
import { created, defineHttp, noContent, ok } from '../../shared/http';
import { geofencesRepo, GeofenceInput } from '../../shared/repositories/geofences';
import { latLng, parse, z } from '../../shared/validation';

const base = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().max(300).optional(),
  shape: z.enum(['circle', 'polygon', 'corridor']),
  center: latLng.nullable().optional(),
  radiusM: z.number().min(20, 'Radio mínimo 20 m').max(50000).nullable().optional(),
  coordinates: z.array(latLng).max(5000).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  vehicleIds: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});

/** Reglas de forma: círculo = centro + radio; polígono ≥ 3 vértices; corredor = polilínea ≥ 2 puntos + ancho. */
function validateShape(g: Partial<GeofenceInput>) {
  if (g.shape === 'circle' && (!g.center || !g.radiusM))
    throw badRequest('Un círculo necesita centro y radio.');
  if (g.shape === 'polygon' && (g.coordinates?.length ?? 0) < 3)
    throw badRequest('Un polígono necesita al menos 3 vértices.');
  if (g.shape === 'corridor' && ((g.coordinates?.length ?? 0) < 2 || !g.radiusM)) {
    throw badRequest('Un corredor de ruta necesita al menos 2 puntos y un ancho.');
  }
}

/* RF6 – Listar geocercas con su estado (activa y vehículos dentro) */
defineHttp({
  name: 'geofences-list',
  route: 'geofences',
  methods: ['GET'],
  guard: { module: 'geofences', level: 'read' },
  handler: (_req, ctx) => ok(geofencesRepo.list(ctx.tenantId)),
});

defineHttp({
  name: 'geofences-get',
  route: 'geofences/{id}',
  methods: ['GET'],
  guard: { module: 'geofences', level: 'read' },
  handler: (req, ctx) => ok(geofencesRepo.get(ctx.tenantId, req.params.id)),
});

/* RF5 – Crear geocerca */
defineHttp({
  name: 'geofences-create',
  route: 'geofences',
  methods: ['POST'],
  guard: { module: 'geofences', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(base, req.body);
    validateShape(body);
    return created(geofencesRepo.create(ctx.tenantId, body));
  },
});

/* RF7 – Actualizar área, nombre o vehículos asociados */
defineHttp({
  name: 'geofences-update',
  route: 'geofences/{id}',
  methods: ['PATCH'],
  guard: { module: 'geofences', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(base.partial(), req.body);
    const cur = geofencesRepo.get(ctx.tenantId, req.params.id);
    validateShape({ ...cur, ...body });
    return ok(geofencesRepo.update(ctx.tenantId, req.params.id, body));
  },
});

/* RF8 – Eliminar (lógicamente) */
defineHttp({
  name: 'geofences-delete',
  route: 'geofences/{id}',
  methods: ['DELETE'],
  guard: { module: 'geofences', level: 'write' },
  handler: (req, ctx) => {
    geofencesRepo.remove(ctx.tenantId, req.params.id);
    return noContent();
  },
});
