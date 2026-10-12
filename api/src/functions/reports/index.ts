import { randomToken } from '../../shared/auth';
import { all, get, id, now, parseJson, run } from '../../shared/db';
import { badRequest, notFound } from '../../shared/errors';
import { created, Ctx, defineHttp, noContent, ok, Res } from '../../shared/http';
import { alertsRepo } from '../../shared/repositories/alerts';
import { isoDate, parse, z } from '../../shared/validation';
import { buildReport, REPORT_TYPE_LABELS, ReportParams } from './builder';

const MIME = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

const params = z
  .object({
    name: z.string().trim().min(3).max(100),
    type: z.enum(['trips', 'alerts', 'usage', 'full']),
    format: z.enum(['pdf', 'xlsx']),
    vehicleId: z.string().nullable().optional(),
    driverId: z.string().nullable().optional(),
    periodStart: isoDate,
    periodEnd: isoDate,
  })
  .refine((p) => Date.parse(p.periodStart) < Date.parse(p.periodEnd), {
    message: 'La fecha inicial debe ser anterior a la final',
    path: ['periodEnd'],
  })
  .refine((p) => Date.parse(p.periodEnd) - Date.parse(p.periodStart) <= 366 * 86400_000, {
    message: 'El periodo máximo es de un año',
    path: ['periodEnd'],
  });

const mapReport = (r: any) => ({
  id: r.id,
  name: r.name,
  type: r.type,
  typeLabel: REPORT_TYPE_LABELS[r.type as ReportParams['type']],
  format: r.format,
  vehicleId: r.vehicle_id,
  vehiclePlate: r.plate ?? null,
  driverId: r.driver_id,
  driverName: r.driver_name ?? null,
  periodStart: r.period_start,
  periodEnd: r.period_end,
  summary: parseJson(r.summary, {}),
  sizeBytes: r.size_bytes,
  version: r.version,
  generatedAt: r.generated_at,
  createdBy: r.created_by_name ?? null,
  activeShares: r.active_shares ?? 0,
});

const SQL = `SELECT r.id, r.name, r.type, r.format, r.vehicle_id, r.driver_id, r.period_start, r.period_end, r.summary, r.size_bytes,
    r.version, r.generated_at, v.plate, d.name AS driver_name, u.name AS created_by_name,
    (SELECT COUNT(*) FROM report_shares s WHERE s.report_id = r.id AND s.revoked_at IS NULL AND s.expires_at > @now) AS active_shares
  FROM reports r LEFT JOIN vehicles v ON v.id = r.vehicle_id LEFT JOIN users d ON d.id = r.driver_id LEFT JOIN users u ON u.id = r.created_by
  WHERE r.company_id = @cid AND r.deleted_at IS NULL`;

function getReport(tenantId: string, reportId: string) {
  const r = get(`${SQL} AND r.id=@id`, { cid: tenantId, id: reportId, now: now() });
  if (!r) throw notFound('Reporte');
  return mapReport(r);
}

function checkRefs(ctx: Ctx, p: { vehicleId?: string | null; driverId?: string | null }) {
  if (
    p.vehicleId &&
    !get(`SELECT id FROM vehicles WHERE id=@id AND company_id=@cid`, { id: p.vehicleId, cid: ctx.tenantId })
  )
    throw notFound('Vehículo');
  if (
    p.driverId &&
    !get(`SELECT id FROM users WHERE id=@id AND company_id=@cid`, { id: p.driverId, cid: ctx.tenantId })
  )
    throw notFound('Conductor');
}

function fileResponse(r: {
  content: Uint8Array;
  format: 'pdf' | 'xlsx';
  name: string;
  version: number;
}): Res {
  const safe =
    r.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9-_ ]/g, '')
      .trim()
      .replace(/\s+/g, '_') || 'reporte';
  return {
    status: 200,
    body: r.content,
    headers: {
      'Content-Type': MIME[r.format],
      'Content-Disposition': `attachment; filename="${safe}_v${r.version}.${r.format}"`,
      'Cache-Control': 'no-store',
    },
  };
}

/* RF20 – Consultar reportes generados */
defineHttp({
  name: 'reports-list',
  route: 'reports',
  methods: ['GET'],
  guard: { module: 'reports', level: 'read' },
  handler: (_req, ctx) =>
    ok(all(`${SQL} ORDER BY r.generated_at DESC`, { cid: ctx.tenantId, now: now() }).map(mapReport)),
});

/* Reportes compartidos conmigo (envío directo, RF33) — disponible aunque no tenga el módulo de reportes */
defineHttp({
  name: 'reports-shared-with-me',
  route: 'reports-shared',
  methods: ['GET'],
  guard: 'authenticated',
  handler: (_req, ctx) =>
    ok(
      all<any>(
        `SELECT s.token, s.message, s.expires_at, s.created_at, r.name, r.format, r.type, u.name AS shared_by
         FROM report_shares s JOIN reports r ON r.id = s.report_id LEFT JOIN users u ON u.id = s.created_by
         WHERE s.shared_with_user_id=@uid AND s.company_id=@cid AND s.revoked_at IS NULL AND s.expires_at > @now AND r.deleted_at IS NULL
         ORDER BY s.created_at DESC`,
        { uid: ctx.user.id, cid: ctx.tenantId, now: now() },
      ).map((s) => ({
        token: s.token,
        name: s.name,
        format: s.format,
        typeLabel: REPORT_TYPE_LABELS[s.type as ReportParams['type']],
        message: s.message,
        sharedBy: s.shared_by,
        expiresAt: s.expires_at,
        createdAt: s.created_at,
      })),
    ),
});

defineHttp({
  name: 'reports-get',
  route: 'reports/{id}',
  methods: ['GET'],
  guard: { module: 'reports', level: 'read' },
  handler: (req, ctx) => ok(getReport(ctx.tenantId, req.params.id)),
});

/* RF19 – Generar reporte personalizado (vehículo, conductor o periodo) en PDF o Excel */
defineHttp({
  name: 'reports-create',
  route: 'reports',
  methods: ['POST'],
  guard: { module: 'reports', level: 'write' },
  handler: async (req, ctx) => {
    const p = parse(params, req.body);
    checkRefs(ctx, p);
    const norm = {
      ...p,
      periodStart: new Date(p.periodStart).toISOString(),
      periodEnd: new Date(p.periodEnd).toISOString(),
    };
    const { content, summary } = await buildReport(ctx.tenantId, norm);
    const rid = id();
    run(
      `INSERT INTO reports (id, company_id, created_by, name, type, format, vehicle_id, driver_id, period_start, period_end, summary, content, size_bytes, version, generated_at)
       VALUES (@id,@cid,@uid,@name,@type,@format,@vehicle,@driver,@ps,@pe,@summary,@content,@size,1,@ts)`,
      {
        id: rid,
        cid: ctx.tenantId,
        uid: ctx.user.id,
        name: norm.name,
        type: norm.type,
        format: norm.format,
        vehicle: norm.vehicleId ?? null,
        driver: norm.driverId ?? null,
        ps: norm.periodStart,
        pe: norm.periodEnd,
        summary: JSON.stringify(summary),
        content,
        size: content.length,
        ts: now(),
      },
    );
    return created(getReport(ctx.tenantId, rid));
  },
});

/* RF21 – Regenerar con nuevos parámetros (incrementa la versión) */
defineHttp({
  name: 'reports-regenerate',
  route: 'reports/{id}/regenerate',
  methods: ['POST'],
  guard: { module: 'reports', level: 'write' },
  handler: async (req, ctx) => {
    const cur = getReport(ctx.tenantId, req.params.id);
    const merged = parse(params, {
      name: cur.name,
      type: cur.type,
      format: cur.format,
      vehicleId: cur.vehicleId,
      driverId: cur.driverId,
      periodStart: cur.periodStart,
      periodEnd: cur.periodEnd,
      ...(req.body ?? {}),
    });
    checkRefs(ctx, merged);
    const norm = {
      ...merged,
      periodStart: new Date(merged.periodStart).toISOString(),
      periodEnd: new Date(merged.periodEnd).toISOString(),
    };
    const { content, summary } = await buildReport(ctx.tenantId, norm);
    run(
      `UPDATE reports SET name=@name, type=@type, format=@format, vehicle_id=@vehicle, driver_id=@driver, period_start=@ps, period_end=@pe,
         summary=@summary, content=@content, size_bytes=@size, version=version+1, generated_at=@ts WHERE id=@id AND company_id=@cid`,
      {
        name: norm.name,
        type: norm.type,
        format: norm.format,
        vehicle: norm.vehicleId ?? null,
        driver: norm.driverId ?? null,
        ps: norm.periodStart,
        pe: norm.periodEnd,
        summary: JSON.stringify(summary),
        content,
        size: content.length,
        ts: now(),
        id: cur.id,
        cid: ctx.tenantId,
      },
    );
    return ok(getReport(ctx.tenantId, cur.id));
  },
});

/* Descargar (exportar PDF / Excel) */
defineHttp({
  name: 'reports-download',
  route: 'reports/{id}/download',
  methods: ['GET'],
  guard: { module: 'reports', level: 'read' },
  handler: (req, ctx) => {
    const r = get<any>(
      `SELECT name, format, content, version FROM reports WHERE id=@id AND company_id=@cid AND deleted_at IS NULL`,
      {
        id: req.params.id,
        cid: ctx.tenantId,
      },
    );
    if (!r?.content) throw notFound('Reporte');
    return fileResponse(r);
  },
});

/* RF22 – Eliminar reporte almacenado (revoca sus enlaces compartidos) */
defineHttp({
  name: 'reports-delete',
  route: 'reports/{id}',
  methods: ['DELETE'],
  guard: { module: 'reports', level: 'write' },
  handler: (req, ctx) => {
    getReport(ctx.tenantId, req.params.id);
    run(`UPDATE reports SET deleted_at=@ts, content=NULL WHERE id=@id AND company_id=@cid`, {
      ts: now(),
      id: req.params.id,
      cid: ctx.tenantId,
    });
    run(`UPDATE report_shares SET revoked_at=@ts WHERE report_id=@id AND revoked_at IS NULL`, {
      ts: now(),
      id: req.params.id,
    });
    return noContent();
  },
});

/* RF33 – Compartir: enlace público con token y expiración, o envío directo a otro usuario */
defineHttp({
  name: 'reports-share',
  route: 'reports/{id}/share',
  methods: ['POST'],
  guard: { module: 'reports', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(
      z.object({
        mode: z.enum(['link', 'user']),
        userId: z.string().optional(),
        expiresInHours: z.number().int().min(1).max(720).default(72),
        message: z.string().max(300).optional(),
      }),
      req.body,
    );
    const report = getReport(ctx.tenantId, req.params.id);
    let target: any = null;
    if (body.mode === 'user') {
      if (!body.userId) throw badRequest('Elige el usuario destinatario.');
      target = get(
        `SELECT id, name, email FROM users WHERE id=@id AND company_id=@cid AND active=1 AND deleted_at IS NULL`,
        {
          id: body.userId,
          cid: ctx.tenantId,
        },
      );
      if (!target) throw notFound('Usuario destinatario');
    }
    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + body.expiresInHours * 3600_000).toISOString();
    const sid = id();
    run(
      `INSERT INTO report_shares (id, company_id, report_id, token, shared_with_user_id, message, expires_at, created_by, created_at)
       VALUES (@id,@cid,@rid,@token,@uid,@msg,@exp,@by,@ts)`,
      {
        id: sid,
        cid: ctx.tenantId,
        rid: report.id,
        token,
        uid: target?.id ?? null,
        msg: body.message ?? '',
        exp: expiresAt,
        by: ctx.user.id,
        ts: now(),
      },
    );
    const path = `/compartido/${token}`;
    if (target) {
      alertsRepo.insertNotification(ctx.tenantId, {
        channel: 'email',
        recipient: target.email,
        subject: `[WMS] ${ctx.user.name} compartió contigo «${report.name}»`,
        body: `${body.message ? `${body.message}\n\n` : ''}Abre el reporte aquí: ${path} (válido hasta ${new Date(expiresAt).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}).`,
      });
    }
    return created({
      id: sid,
      token,
      path,
      expiresAt,
      sharedWith: target ? { id: target.id, name: target.name } : null,
    });
  },
});

defineHttp({
  name: 'reports-shares-list',
  route: 'reports/{id}/shares',
  methods: ['GET'],
  guard: { module: 'reports', level: 'read' },
  handler: (req, ctx) => {
    getReport(ctx.tenantId, req.params.id);
    return ok(
      all<any>(
        `SELECT s.*, u.name AS user_name FROM report_shares s LEFT JOIN users u ON u.id = s.shared_with_user_id
         WHERE s.report_id=@id AND s.company_id=@cid ORDER BY s.created_at DESC`,
        { id: req.params.id, cid: ctx.tenantId },
      ).map((s) => ({
        id: s.id,
        token: s.token,
        path: `/compartido/${s.token}`,
        sharedWith: s.user_name,
        expiresAt: s.expires_at,
        createdAt: s.created_at,
        revoked: !!s.revoked_at,
        expired: s.expires_at < now(),
      })),
    );
  },
});

defineHttp({
  name: 'reports-share-revoke',
  route: 'report-shares/{id}',
  methods: ['DELETE'],
  guard: { module: 'reports', level: 'write' },
  handler: (req, ctx) => {
    const r = run(
      `UPDATE report_shares SET revoked_at=@ts WHERE id=@id AND company_id=@cid AND revoked_at IS NULL`,
      {
        ts: now(),
        id: req.params.id,
        cid: ctx.tenantId,
      },
    );
    if (!r.changes) throw notFound('Enlace compartido');
    return noContent();
  },
});

/* Acceso público por token (sin sesión): metadatos y descarga */
function sharedReport(token: string) {
  const s = get<any>(
    `SELECT s.*, r.name, r.type, r.format, r.summary, r.period_start, r.period_end, r.generated_at, r.version, r.content, c.name AS company
     FROM report_shares s JOIN reports r ON r.id = s.report_id JOIN companies c ON c.id = s.company_id
     WHERE s.token=@t AND r.deleted_at IS NULL`,
    { t: token },
  );
  if (!s || s.revoked_at) throw notFound('Enlace');
  if (s.expires_at < now())
    throw badRequest('Este enlace expiró. Pide a quien lo compartió que genere uno nuevo.');
  return s;
}

defineHttp({
  name: 'public-report',
  route: 'public/reports/{token}',
  methods: ['GET'],
  guard: 'public',
  handler: (req) => {
    const s = sharedReport(req.params.token);
    return ok({
      name: s.name,
      typeLabel: REPORT_TYPE_LABELS[s.type as ReportParams['type']],
      format: s.format,
      company: s.company,
      message: s.message,
      periodStart: s.period_start,
      periodEnd: s.period_end,
      generatedAt: s.generated_at,
      expiresAt: s.expires_at,
      summary: parseJson(s.summary, {}),
    });
  },
});

defineHttp({
  name: 'public-report-download',
  route: 'public/reports/{token}/download',
  methods: ['GET'],
  guard: 'public',
  handler: (req) => fileResponse(sharedReport(req.params.token)),
});
