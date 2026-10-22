import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { PAYMENT_GATEWAY, type GatewayEvent, type PaymentGateway } from './payment-gateway';

const DAY_MS = 86_400_000;

// Placeholder prices: the admin edits them in the Plans screen (PATCH /admin/plans/:id).
const DEFAULT_PLANS = [
  { id: 'plan-monthly', name: 'Monthly', period: 'monthly', amount: 499, durationDays: 30, badge: null, sortOrder: 1 },
  { id: 'plan-quarterly', name: 'Quarterly', period: 'quarterly', amount: 1349, durationDays: 90, badge: 'Save 10%', sortOrder: 2 },
  { id: 'plan-yearly', name: 'Yearly', period: 'yearly', amount: 5090, durationDays: 365, badge: 'Save 15%', sortOrder: 3 },
];

const SETTING_DEFAULTS = {
  // Days after the due date before Unpaid becomes Overdue, and before the account is suspended.
  'billing.overdueAfterDays': 3,
  'billing.suspendAfterDays': 7,
};
export type BillingSettingKey = keyof typeof SETTING_DEFAULTS;

@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async onModuleInit() {
    try {
      if ((await this.prisma.plan.count()) === 0) {
        await this.prisma.plan.createMany({ data: DEFAULT_PLANS });
        this.logger.log('Created the default billing plans (placeholder prices).');
      }
    } catch (err) {
      // e.g. the new tables aren't pushed to this database yet
      this.logger.warn(`Could not ensure default plans: ${(err as Error).message}`);
    }
    this.logger.log(`Payment gateway: ${this.gateway.name}`);
  }

  // ── settings ──────────────────────────────────────────────────────────────
  async getSettings() {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: Object.keys(SETTING_DEFAULTS) } } });
    const out: Record<string, number> = { ...SETTING_DEFAULTS };
    for (const r of rows) {
      const n = Number(r.value);
      if (Number.isFinite(n)) out[r.key] = n;
    }
    return out as Record<BillingSettingKey, number>;
  }

  async updateSettings(actorId: string, changes: Partial<Record<BillingSettingKey, number>>) {
    for (const [key, value] of Object.entries(changes)) {
      if (!(key in SETTING_DEFAULTS)) continue;
      await this.prisma.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
    }
    await this.audit.record({ actorId, action: 'billing.settings', targetType: 'setting', targetId: 'billing', meta: { changes } });
    return this.getSettings();
  }

  // ── plans ─────────────────────────────────────────────────────────────────
  async listPlans(includeInactive = false) {
    return this.prisma.plan.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, period: true, amount: true, durationDays: true, badge: true, active: true },
    });
  }

  async updatePlan(
    actorId: string,
    id: string,
    data: { name?: string; amount?: number; durationDays?: number; badge?: string | null; active?: boolean },
  ) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    const updated = await this.prisma.plan.update({ where: { id }, data });
    await this.audit.record({ actorId, action: 'plan.update', targetType: 'plan', targetId: id, meta: { before: plan, changes: data } });
    return updated;
  }

  // ── customer view ─────────────────────────────────────────────────────────
  async getMyBilling(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { plan: true } });
    if (!user) throw new NotFoundException('User not found');

    const payments = await this.prisma.payment.findMany({
      where: { userId, status: { in: ['Paid', 'Failed', 'Refunded'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { plan: { select: { name: true } } },
    });
    const lastPaid = payments.find((p) => p.status === 'Paid');

    return {
      plan: user.plan
        ? { id: user.plan.id, name: user.plan.name, period: user.plan.period, amount: user.plan.amount }
        : null,
      paymentStatus: user.paymentStatus,
      paidUntil: user.paidUntil,
      lastPaidAt: lastPaid?.paidAt ?? null,
      payments: payments.map((p) => ({
        id: p.id,
        date: p.paidAt ?? p.createdAt,
        plan: p.plan?.name ?? '—',
        amount: p.amount,
        status: p.status,
        invoiceUrl: null, // invoices PDF: not built yet
      })),
    };
  }

  async createOrder(userId: string, planId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.enabled) {
      throw new ForbiddenException({ code: 'ACCOUNT_DISABLED', message: 'Your account has been disabled.' });
    }
    if (user.accountStatus === 'Pending') {
      throw new ForbiddenException({ code: 'ACCOUNT_PENDING', message: 'Your account is waiting for admin approval.' });
    }
    const plan = await this.prisma.plan.findFirst({ where: { id: planId, active: true } });
    if (!plan) throw new NotFoundException('Plan not found');

    // The amount always comes from the plan row, never from the browser.
    const payment = await this.prisma.payment.create({
      data: { userId, planId: plan.id, amount: plan.amount, status: 'Created', method: 'online', gateway: this.gateway.name },
    });
    const order = await this.gateway.createOrder({ amountPaise: plan.amount * 100, receipt: payment.id });
    await this.prisma.payment.update({ where: { id: payment.id }, data: { gatewayOrderId: order.orderId } });

    return { orderId: order.orderId, amount: plan.amount * 100, currency: 'INR', keyId: order.keyId };
  }

  // ── payment results (webhook / dev confirm) ───────────────────────────────
  async handleGatewayEvent(event: GatewayEvent) {
    if (event.type === 'ignored' || !event.orderId) return;
    if (event.type === 'paid') {
      await this.applyPaid(event.orderId, event.paymentId, event.amountPaise);
    } else {
      await this.prisma.payment.updateMany({
        where: { gatewayOrderId: event.orderId, status: 'Created' },
        data: { status: 'Failed', gatewayPaymentId: event.paymentId ?? undefined },
      });
    }
  }

  /** Idempotent: a repeated webhook for the same order never extends the plan twice. */
  async applyPaid(gatewayOrderId: string, gatewayPaymentId?: string, amountPaise?: number) {
    const payment = await this.prisma.payment.findUnique({ where: { gatewayOrderId }, include: { plan: true } });
    if (!payment) {
      this.logger.warn(`Paid event for unknown order ${gatewayOrderId}`);
      return;
    }
    if (amountPaise !== undefined && amountPaise !== payment.amount * 100) {
      this.logger.error(`Amount mismatch on order ${gatewayOrderId}: got ${amountPaise}, expected ${payment.amount * 100}`);
      return;
    }
    if (!payment.plan) return;

    const plan = payment.plan;
    const extended = await this.prisma.$transaction(async (tx) => {
      // Only the first writer flips the status; everyone else sees count 0 and stops.
      const flipped = await tx.payment.updateMany({
        where: { id: payment.id, status: { not: 'Paid' } },
        data: { status: 'Paid', paidAt: new Date(), gatewayPaymentId: gatewayPaymentId ?? undefined },
      });
      if (flipped.count === 0) return false;
      await this.extendSubscription(tx, payment.userId, plan);
      return true;
    });

    if (extended) {
      await this.audit.record({
        actorId: null,
        action: 'payment.paid',
        targetType: 'user',
        targetId: payment.userId,
        meta: { paymentId: payment.id, planId: plan.id, amount: payment.amount, gatewayPaymentId },
      });
    }
  }

  private async extendSubscription(
    tx: Pick<PrismaService, 'user'>,
    userId: string,
    plan: { id: string; durationDays: number },
  ) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const base = user.paidUntil && user.paidUntil.getTime() > Date.now() ? user.paidUntil.getTime() : Date.now();
    await tx.user.update({
      where: { id: userId },
      data: {
        paymentStatus: 'Paid',
        planId: plan.id,
        paidUntil: new Date(base + plan.durationDays * DAY_MS),
        // Paying lifts a non-payment suspension (a hard-disabled account stays disabled).
        ...(user.accountStatus === 'Suspended' && user.enabled ? { accountStatus: 'Active' } : {}),
      },
    });
  }

  /** Admin: record a payment taken outside the app (cash, bank transfer, UPI). */
  async markPaidOffline(actorId: string, userId: string, note?: string, planId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const plan = planId
      ? await this.prisma.plan.findUnique({ where: { id: planId } })
      : user.planId
        ? await this.prisma.plan.findUnique({ where: { id: user.planId } })
        : await this.prisma.plan.findFirst({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
    if (!plan) throw new BadRequestException('No plan available. Create a plan first.');

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          userId,
          planId: plan.id,
          amount: plan.amount,
          status: 'Paid',
          method: 'offline',
          gateway: 'manual',
          note: note || null,
          paidAt: new Date(),
        },
      });
      await this.extendSubscription(tx, userId, plan);
      return created;
    });
    await this.audit.record({
      actorId,
      action: 'payment.mark_paid',
      targetType: 'user',
      targetId: userId,
      meta: { paymentId: payment.id, planId: plan.id, amount: plan.amount, note },
    });
    return payment;
  }

  // ── admin overview ────────────────────────────────────────────────────────
  async adminPayments() {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [payments, dueUsers, collected, failed] = await Promise.all([
      this.prisma.payment.findMany({
        where: { status: { in: ['Paid', 'Failed', 'Refunded'] } },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { user: { select: { name: true, email: true, devices: { select: { id: true }, take: 1 } } } },
      }),
      this.prisma.user.findMany({
        where: { role: { not: 'admin' }, paymentStatus: { in: ['Unpaid', 'Overdue'] } },
        include: { plan: true, devices: { select: { id: true }, take: 1 } },
      }),
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'Paid', paidAt: { gte: monthStart } } }),
      this.prisma.payment.count({ where: { status: 'Failed' } }),
    ]);

    const paymentRows = payments.map((p) => ({
      id: p.id,
      userId: p.userId,
      userName: p.user.name || p.user.email,
      deviceId: p.user.devices[0]?.id ?? null,
      date: p.paidAt ?? p.createdAt,
      amount: p.amount,
      status: p.status,
      method: p.method,
    }));
    const dueRows = dueUsers.map((u) => ({
      id: `due-${u.id}`,
      userId: u.id,
      userName: u.name || u.email,
      deviceId: u.devices[0]?.id ?? null,
      date: u.paidUntil,
      amount: u.plan?.amount ?? 0,
      status: u.paymentStatus,
      method: null,
    }));

    return {
      summary: {
        collectedThisMonth: collected._sum.amount ?? 0,
        unpaid: dueUsers.filter((u) => u.paymentStatus === 'Unpaid').length,
        overdue: dueUsers.filter((u) => u.paymentStatus === 'Overdue').length,
        failed,
      },
      payments: [...dueRows, ...paymentRows],
    };
  }

  // ── daily sweep (run by the BullMQ job) ───────────────────────────────────
  /** Paid -> Unpaid once due, Unpaid -> Overdue after a few days, then suspend. Returns what it changed. */
  async runDueSweep(now = new Date()) {
    const settings = await this.getSettings();
    const overdueAt = new Date(now.getTime() - settings['billing.overdueAfterDays'] * DAY_MS);
    const suspendAt = new Date(now.getTime() - settings['billing.suspendAfterDays'] * DAY_MS);
    const subscribers = { role: { not: 'admin' }, paidUntil: { not: null } };

    const unpaid = await this.prisma.user.updateMany({
      where: { ...subscribers, paymentStatus: 'Paid', paidUntil: { lt: now } },
      data: { paymentStatus: 'Unpaid' },
    });
    const overdue = await this.prisma.user.updateMany({
      where: { ...subscribers, paymentStatus: 'Unpaid', paidUntil: { lt: overdueAt } },
      data: { paymentStatus: 'Overdue' },
    });

    const toSuspend = await this.prisma.user.findMany({
      where: { ...subscribers, accountStatus: 'Active', paymentStatus: { in: ['Unpaid', 'Overdue'] }, paidUntil: { lt: suspendAt } },
      select: { id: true },
    });
    for (const u of toSuspend) {
      await this.prisma.user.update({ where: { id: u.id }, data: { accountStatus: 'Suspended' } });
      await this.sessions.revokeAll(u.id);
      await this.audit.record({ actorId: null, action: 'billing.auto_suspend', targetType: 'user', targetId: u.id });
    }

    const result = { markedUnpaid: unpaid.count, markedOverdue: overdue.count, suspended: toSuspend.length };
    this.logger.log(`Due sweep: ${JSON.stringify(result)}`);
    return result;
  }
}
