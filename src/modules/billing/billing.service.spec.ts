import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { PAYMENT_GATEWAY } from './payment-gateway';

const DAY = 86_400_000;

describe('BillingService', () => {
  let service: BillingService;
  const tx = {
    payment: { updateMany: jest.fn(), create: jest.fn() },
    user: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
  };
  const prisma: any = {
    plan: { count: jest.fn().mockResolvedValue(3), findFirst: jest.fn(), findUnique: jest.fn() },
    payment: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    user: { findUnique: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    setting: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((fn) => fn(tx)),
  };
  const audit = { record: jest.fn() };
  const sessions = { revokeAll: jest.fn() };
  const gateway = { name: 'stub', createOrder: jest.fn(), parseWebhook: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.setting.findMany.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: SessionService, useValue: sessions },
        { provide: PAYMENT_GATEWAY, useValue: gateway },
      ],
    }).compile();
    service = module.get(BillingService);
  });

  describe('createOrder', () => {
    it('takes the amount from the plan (in paise), never from the caller', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', enabled: true, accountStatus: 'Active' });
      prisma.plan.findFirst.mockResolvedValue({ id: 'p1', amount: 499 });
      prisma.payment.create.mockResolvedValue({ id: 'pay1' });
      gateway.createOrder.mockResolvedValue({ orderId: 'o1', keyId: 'k' });

      const order = await service.createOrder('u1', 'p1');

      expect(gateway.createOrder).toHaveBeenCalledWith({ amountPaise: 49900, receipt: 'pay1' });
      expect(order).toMatchObject({ orderId: 'o1', amount: 49900, currency: 'INR' });
    });

    it('does not let a pending account pay yet', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', enabled: true, accountStatus: 'Pending' });
      await expect(service.createOrder('u1', 'p1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('applyPaid', () => {
    const payment = { id: 'pay1', userId: 'u1', amount: 499, plan: { id: 'p1', durationDays: 30 } };

    it('extends the subscription once and reactivates a suspended user', async () => {
      prisma.payment.findUnique.mockResolvedValue(payment);
      tx.payment.updateMany.mockResolvedValue({ count: 1 });
      tx.user.findUniqueOrThrow.mockResolvedValue({ paidUntil: null, accountStatus: 'Suspended', enabled: true });

      await service.applyPaid('o1', 'gp1', 49900);

      const data = tx.user.update.mock.calls[0][0].data;
      expect(data.paymentStatus).toBe('Paid');
      expect(data.accountStatus).toBe('Active');
      expect(data.paidUntil.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    });

    it('a repeated webhook does not extend the plan a second time', async () => {
      prisma.payment.findUnique.mockResolvedValue(payment);
      tx.payment.updateMany.mockResolvedValue({ count: 0 }); // already Paid

      await service.applyPaid('o1', 'gp1', 49900);

      expect(tx.user.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('ignores a payment whose amount does not match the order', async () => {
      prisma.payment.findUnique.mockResolvedValue(payment);
      await service.applyPaid('o1', 'gp1', 100);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('adds the new period after the current due date when still in credit', async () => {
      const future = new Date(Date.now() + 10 * DAY);
      prisma.payment.findUnique.mockResolvedValue(payment);
      tx.payment.updateMany.mockResolvedValue({ count: 1 });
      tx.user.findUniqueOrThrow.mockResolvedValue({ paidUntil: future, accountStatus: 'Active', enabled: true });

      await service.applyPaid('o1', 'gp1', 49900);

      const data = tx.user.update.mock.calls[0][0].data;
      expect(data.paidUntil.getTime()).toBe(future.getTime() + 30 * DAY);
    });
  });

  describe('markPaidOffline', () => {
    it('fails clearly when there is no plan to charge', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', planId: null });
      prisma.plan.findFirst.mockResolvedValue(null);
      await expect(service.markPaidOffline('admin', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('runDueSweep', () => {
    it('suspends users past the grace period and signs them out', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      prisma.user.findMany.mockResolvedValue([{ id: 'late1' }]);

      const result = await service.runDueSweep();

      expect(result.suspended).toBe(1);
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'late1' }, data: { accountStatus: 'Suspended' } });
      expect(sessions.revokeAll).toHaveBeenCalledWith('late1');
    });

    it('never touches admin accounts or users who never paid', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      prisma.user.findMany.mockResolvedValue([]);

      await service.runDueSweep();

      for (const [arg] of prisma.user.updateMany.mock.calls) {
        expect(arg.where.role).toEqual({ not: 'admin' });
        expect(arg.where.paidUntil).toBeDefined();
      }
    });
  });
});
