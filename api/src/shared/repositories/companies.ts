import { all, get, id, now, parseJson, run, tx } from '../db';
import { conflict, notFound, planLimit } from '../errors';

export interface PlanDto {
  id: string;
  code: string;
  name: string;
  description: string;
  priceCop: number;
  maxVehicles: number;
  maxUsers: number;
  features: string[];
}

const mapPlan = (r: any): PlanDto => ({
  id: r.id,
  code: r.code,
  name: r.name,
  description: r.description,
  priceCop: r.price_cop,
  maxVehicles: r.max_vehicles,
  maxUsers: r.max_users,
  features: parseJson(r.features, []),
});

export const plansRepo = {
  list: (): PlanDto[] => all(`SELECT * FROM plans ORDER BY sort`).map(mapPlan),
  byCode: (code: string) => {
    const r = get(`SELECT * FROM plans WHERE code = @code`, { code });
    return r ? mapPlan(r) : undefined;
  },
};

const addMonths = (iso: string, n: number) => {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString();
};

const IVA = 0.19;

export const companiesRepo = {
  get(companyId: string) {
    const c = get<any>(`SELECT * FROM companies WHERE id = @id`, { id: companyId });
    if (!c) throw notFound('Empresa');
    return {
      id: c.id,
      name: c.name,
      nit: c.nit,
      email: c.email,
      phone: c.phone,
      city: c.city,
      address: c.address,
      createdAt: c.created_at,
    };
  },

  update(
    companyId: string,
    data: Partial<{ name: string; nit: string; email: string; phone: string; city: string; address: string }>,
  ) {
    const cur = this.get(companyId);
    const next = { ...cur, ...data };
    run(
      `UPDATE companies SET name=@name, nit=@nit, email=@email, phone=@phone, city=@city, address=@address WHERE id=@id`,
      {
        id: companyId,
        name: next.name,
        nit: next.nit,
        email: next.email,
        phone: next.phone,
        city: next.city,
        address: next.address,
      },
    );
    return this.get(companyId);
  },

  /** Suscripción vigente con plan y uso actual (RF24). */
  subscription(companyId: string) {
    const s = get<any>(
      `SELECT s.*, p.code AS plan_code FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.company_id = @cid ORDER BY s.started_at DESC LIMIT 1`,
      { cid: companyId },
    );
    if (!s) throw notFound('Suscripción');
    const plan = plansRepo.byCode(s.plan_code)!;
    const usage = this.usage(companyId);
    return {
      id: s.id,
      status: s.status as string,
      startedAt: s.started_at,
      currentPeriodStart: s.current_period_start,
      currentPeriodEnd: s.current_period_end,
      canceledAt: s.canceled_at,
      cancelReason: s.cancel_reason,
      plan,
      usage,
    };
  },

  usage(companyId: string) {
    const v = get<{ n: number }>(
      `SELECT COUNT(*) n FROM vehicles WHERE company_id=@cid AND retired_at IS NULL`,
      { cid: companyId },
    )!.n;
    const u = get<{ n: number }>(
      `SELECT COUNT(*) n FROM users WHERE company_id=@cid AND deleted_at IS NULL`,
      { cid: companyId },
    )!.n;
    const d = get<{ n: number }>(
      `SELECT COUNT(*) n FROM devices WHERE company_id=@cid AND status <> 'retired'`,
      { cid: companyId },
    )!.n;
    return { vehicles: v, users: u, devices: d };
  },

  /** Límites del plan (RG7): lanza 402 PLAN_LIMIT con un mensaje claro. */
  assertCanAdd(companyId: string, what: 'vehicles' | 'users') {
    const sub = this.subscription(companyId);
    if (sub.status === 'canceled')
      throw planLimit('La suscripción está cancelada. Reactívala para agregar registros.');
    const max = what === 'vehicles' ? sub.plan.maxVehicles : sub.plan.maxUsers;
    const used = sub.usage[what];
    if (used >= max) {
      const label = what === 'vehicles' ? 'vehículos' : 'usuarios';
      throw planLimit(
        `Tu plan ${sub.plan.name} permite hasta ${max} ${label} y ya tienes ${used}. Cambia a un plan superior para agregar más.`,
        { plan: sub.plan.code, max, used },
      );
    }
  },

  /** RF23: crea empresa + suscripción + primera factura (el usuario responsable se crea en usersRepo). */
  createWithPlan(input: {
    name: string;
    nit: string;
    email: string;
    phone: string;
    city: string;
    planCode: string;
    startedAt?: string;
  }) {
    const plan = plansRepo.byCode(input.planCode);
    if (!plan) throw notFound('Plan');
    const existing = get(`SELECT id FROM companies WHERE nit = @nit AND nit <> ''`, { nit: input.nit });
    if (existing) throw conflict('Ya existe una empresa registrada con ese NIT.');
    return tx(() => {
      const cid = id();
      const ts = input.startedAt ?? now();
      run(
        `INSERT INTO companies (id, name, nit, email, phone, city, created_at) VALUES (@id,@name,@nit,@email,@phone,@city,@ts)`,
        { id: cid, ...input, ts },
      );
      const sid = id();
      run(
        `INSERT INTO subscriptions (id, company_id, plan_id, status, started_at, current_period_start, current_period_end)
         VALUES (@id,@cid,@pid,'active',@ts,@ts,@end)`,
        { id: sid, cid, pid: plan.id, ts, end: addMonths(ts, 1) },
      );
      this.issueInvoice(cid, sid, plan, ts, 'pending');
      return cid;
    });
  },

  issueInvoice(
    companyId: string,
    subscriptionId: string,
    plan: PlanDto,
    periodStart: string,
    status: 'paid' | 'pending',
    amountOverride?: number,
  ) {
    const count = get<{ n: number }>(`SELECT COUNT(*) n FROM invoices`)!.n;
    const amount = amountOverride ?? plan.priceCop;
    const tax = Math.round(amount * IVA);
    run(
      `INSERT INTO invoices (id, company_id, subscription_id, number, plan_name, amount_cop, tax_cop, status, period_start, period_end, issued_at, due_at, paid_at)
       VALUES (@id,@cid,@sid,@num,@plan,@amount,@tax,@status,@ps,@pe,@ps,@due,@paid)`,
      {
        id: id(),
        cid: companyId,
        sid: subscriptionId,
        num: `WMS-${String(1001 + count).padStart(6, '0')}`,
        plan: plan.name,
        amount,
        tax,
        status,
        ps: periodStart,
        pe: addMonths(periodStart, 1),
        due: new Date(new Date(periodStart).getTime() + 10 * 86400_000).toISOString(),
        paid: status === 'paid' ? periodStart : null,
      },
    );
  },

  /** RF25: cambio de plan con validación de límites y factura de prorrateo. */
  changePlan(companyId: string, planCode: string) {
    const plan = plansRepo.byCode(planCode);
    if (!plan) throw notFound('Plan');
    const sub = this.subscription(companyId);
    if (sub.plan.code === planCode && sub.status !== 'canceled') throw conflict('Ya tienes ese plan.');
    if (sub.usage.vehicles > plan.maxVehicles) {
      throw planLimit(
        `No puedes bajar a ${plan.name}: tienes ${sub.usage.vehicles} vehículos y el plan permite ${plan.maxVehicles}. Da de baja vehículos primero.`,
      );
    }
    if (sub.usage.users > plan.maxUsers) {
      throw planLimit(
        `No puedes bajar a ${plan.name}: tienes ${sub.usage.users} usuarios y el plan permite ${plan.maxUsers}.`,
      );
    }
    tx(() => {
      const ts = now();
      run(
        `UPDATE subscriptions SET plan_id=@pid, status='active', canceled_at=NULL, cancel_reason=NULL,
           current_period_start=@ts, current_period_end=@end WHERE id=@id`,
        { pid: plan.id, ts, end: addMonths(ts, 1), id: sub.id },
      );
      this.issueInvoice(companyId, sub.id, plan, ts, 'pending');
    });
    return this.subscription(companyId);
  },

  /** RF26: cancelación (borrado lógico de la suscripción; los datos se conservan). */
  cancel(companyId: string, reason: string) {
    const sub = this.subscription(companyId);
    if (sub.status === 'canceled') throw conflict('La suscripción ya está cancelada.');
    run(`UPDATE subscriptions SET status='canceled', canceled_at=@ts, cancel_reason=@reason WHERE id=@id`, {
      ts: now(),
      reason,
      id: sub.id,
    });
    return this.subscription(companyId);
  },

  invoices(companyId: string) {
    return all<any>(`SELECT * FROM invoices WHERE company_id=@cid ORDER BY issued_at DESC`, {
      cid: companyId,
    }).map((r) => ({
      id: r.id,
      number: r.number,
      planName: r.plan_name,
      amountCop: r.amount_cop,
      taxCop: r.tax_cop,
      totalCop: r.amount_cop + r.tax_cop,
      status: r.status,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      issuedAt: r.issued_at,
      dueAt: r.due_at,
      paidAt: r.paid_at,
    }));
  },

  /** Pago simulado de factura (pasarela fuera de alcance del PPI). */
  payInvoice(companyId: string, invoiceId: string) {
    const r = run(
      `UPDATE invoices SET status='paid', paid_at=@ts WHERE id=@id AND company_id=@cid AND status='pending'`,
      {
        ts: now(),
        id: invoiceId,
        cid: companyId,
      },
    );
    if (!r.changes) throw notFound('Factura pendiente');
    return this.invoices(companyId).find((i) => i.id === invoiceId);
  },
};
