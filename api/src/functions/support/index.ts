import { all, get, id, now, run } from '../../shared/db';
import { notFound } from '../../shared/errors';
import { Ctx, created, defineHttp, ok } from '../../shared/http';
import { parse, z } from '../../shared/validation';

/**
 * Soporte técnico. Los usuarios de cada empresa ven sólo sus tickets (filtro por tenant).
 * El Agente de Soporte pertenece a la empresa plataforma (WMS) y es la ÚNICA excepción documentada
 * al filtro de tenant: atiende tickets de todas las empresas, sin acceso al resto de sus datos.
 */
const isAgent = (ctx: Ctx) => ctx.user.role === 'support' && ctx.user.isPlatform;

const SQL = `SELECT t.*, c.name AS company_name, u.name AS created_by_name, a.name AS assigned_to_name,
  (SELECT COUNT(*) FROM ticket_comments tc WHERE tc.ticket_id = t.id) AS comments
  FROM tickets t JOIN companies c ON c.id = t.company_id LEFT JOIN users u ON u.id = t.created_by LEFT JOIN users a ON a.id = t.assigned_to
  WHERE (@agent = 1 OR t.company_id = @cid)`;

const map = (r: any) => ({
  id: r.id,
  number: r.number,
  companyId: r.company_id,
  companyName: r.company_name,
  subject: r.subject,
  description: r.description,
  category: r.category,
  priority: r.priority,
  status: r.status,
  createdBy: r.created_by_name,
  assignedTo: r.assigned_to_name,
  comments: r.comments,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function getTicket(ctx: Ctx, ticketId: string) {
  const r = get(`${SQL} AND t.id=@id`, { agent: isAgent(ctx) ? 1 : 0, cid: ctx.tenantId, id: ticketId });
  if (!r) throw notFound('Ticket');
  return map(r);
}

defineHttp({
  name: 'tickets-list',
  route: 'tickets',
  methods: ['GET'],
  guard: { module: 'support', level: 'read' },
  handler: (req, ctx) =>
    ok(
      all(
        `${SQL} AND (@status IS NULL OR t.status=@status) ORDER BY t.status IN ('resolved','closed'), t.updated_at DESC`,
        {
          agent: isAgent(ctx) ? 1 : 0,
          cid: ctx.tenantId,
          status: req.query.get('status') ?? null,
        },
      ).map(map),
    ),
});

defineHttp({
  name: 'tickets-get',
  route: 'tickets/{id}',
  methods: ['GET'],
  guard: { module: 'support', level: 'read' },
  handler: (req, ctx) => {
    const t = getTicket(ctx, req.params.id);
    const comments = all<any>(
      `SELECT tc.*, u.name AS author, u.role FROM ticket_comments tc LEFT JOIN users u ON u.id = tc.author_id WHERE tc.ticket_id=@id ORDER BY tc.created_at`,
      { id: t.id },
    ).map((c) => ({
      id: c.id,
      author: c.author,
      isAgent: c.role === 'support',
      body: c.body,
      createdAt: c.created_at,
    }));
    return ok({ ...t, thread: comments });
  },
});

defineHttp({
  name: 'tickets-create',
  route: 'tickets',
  methods: ['POST'],
  guard: { module: 'support', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(
      z.object({
        subject: z.string().trim().min(4).max(120),
        description: z.string().trim().min(10, 'Describe el problema (mínimo 10 caracteres)').max(3000),
        category: z.enum(['general', 'gps', 'facturacion', 'cuenta', 'mapa', 'reportes']).default('general'),
        priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
      }),
      req.body,
    );
    const n = get<{ n: number }>(`SELECT COALESCE(MAX(number), 1000) n FROM tickets`)!.n + 1;
    const tid = id();
    run(
      `INSERT INTO tickets (id, company_id, number, created_by, subject, description, category, priority, status, created_at, updated_at)
       VALUES (@id,@cid,@n,@uid,@subject,@description,@category,@priority,'open',@ts,@ts)`,
      { id: tid, cid: ctx.tenantId, n, uid: ctx.user.id, ...body, ts: now() },
    );
    return created(getTicket(ctx, tid));
  },
});

/* Cambiar estado / asignarse (agente) */
defineHttp({
  name: 'tickets-update',
  route: 'tickets/{id}',
  methods: ['PATCH'],
  guard: { module: 'support', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(
      z.object({
        status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        assignToMe: z.boolean().optional(),
      }),
      req.body,
    );
    const t = getTicket(ctx, req.params.id);
    // Los clientes sólo pueden cerrar o reabrir sus tickets; los agentes gestionan todo el flujo.
    const status = isAgent(ctx)
      ? body.status
      : body.status && ['closed', 'open'].includes(body.status)
        ? body.status
        : undefined;
    run(
      `UPDATE tickets SET status=COALESCE(@status, status), priority=COALESCE(@priority, priority),
         assigned_to=CASE WHEN @assign = 1 THEN @uid ELSE assigned_to END, updated_at=@ts WHERE id=@id`,
      {
        status: status ?? null,
        priority: isAgent(ctx) ? (body.priority ?? null) : null,
        assign: isAgent(ctx) && body.assignToMe ? 1 : 0,
        uid: ctx.user.id,
        ts: now(),
        id: t.id,
      },
    );
    return ok(getTicket(ctx, t.id));
  },
});

defineHttp({
  name: 'tickets-comment',
  route: 'tickets/{id}/comments',
  methods: ['POST'],
  guard: { module: 'support', level: 'write' },
  handler: (req, ctx) => {
    const body = parse(z.object({ body: z.string().trim().min(1).max(3000) }), req.body);
    const t = getTicket(ctx, req.params.id);
    run(
      `INSERT INTO ticket_comments (id, ticket_id, author_id, body, created_at) VALUES (@id,@t,@u,@b,@ts)`,
      {
        id: id(),
        t: t.id,
        u: ctx.user.id,
        b: body.body,
        ts: now(),
      },
    );
    const autoStatus = isAgent(ctx) && t.status === 'open' ? 'in_progress' : null;
    run(`UPDATE tickets SET updated_at=@ts, status=COALESCE(@s, status) WHERE id=@id`, {
      ts: now(),
      s: autoStatus,
      id: t.id,
    });
    return created({ ok: true });
  },
});
