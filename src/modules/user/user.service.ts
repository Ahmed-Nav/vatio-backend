import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';

const USER_INCLUDE = {
  devices: { select: { id: true }, orderBy: { createdAt: 'asc' as const } },
  plan: { select: { id: true, name: true, period: true, amount: true } },
};

type UserWithRelations = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  pincode: string | null;
  enabled: boolean;
  accountStatus: string;
  paymentStatus: string;
  paidUntil: Date | null;
  lastLogin: Date | null;
  role: string;
  devices: { id: string }[];
  plan: { id: string; name: string; period: string; amount: number } | null;
};

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  private toListItem(user: UserWithRelations) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      address: [user.address1, user.address2].filter(Boolean).join(', ') || null,
      address1: user.address1,
      address2: user.address2,
      city: user.city,
      pincode: user.pincode,
      // `deviceId` is the first device (kept for the existing screen); `deviceIds` lists them all.
      deviceId: user.devices[0]?.id ?? null,
      deviceIds: user.devices.map((d) => d.id),
      enabled: user.enabled,
      accountStatus: user.accountStatus,
      paymentStatus: user.paymentStatus,
      paidUntil: user.paidUntil,
      plan: user.plan,
      lastLogin: user.lastLogin,
      role: user.role,
    };
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
      where: { role: { not: 'admin' } },
      include: USER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return users.map((u) => this.toListItem(u));
  }

  async update(actorId: string, id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'admin' && (dto.enabled === false || (dto.accountStatus && dto.accountStatus !== 'Active'))) {
      throw new BadRequestException('Admin accounts cannot be disabled or suspended');
    }

    if (dto.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
      if (!plan) throw new NotFoundException('Plan not found');
    }

    if (dto.deviceId) {
      const device = await this.prisma.device.findUnique({ where: { id: dto.deviceId } });
      if (!device) throw new NotFoundException('Invalid Device ID');
      if (device.ownerId && device.ownerId !== id) {
        throw new ConflictException(
          'This device belongs to another user. Unassign it first (PATCH /devices/:id/owner).',
        );
      }
      await this.prisma.device.update({ where: { id: dto.deviceId }, data: { ownerId: id } });
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.accountStatus !== undefined && { accountStatus: dto.accountStatus }),
        ...(dto.paymentStatus !== undefined && { paymentStatus: dto.paymentStatus }),
        ...(dto.paidUntil !== undefined && { paidUntil: new Date(dto.paidUntil) }),
        ...(dto.planId !== undefined && { planId: dto.planId }),
      },
      include: USER_INCLUDE,
    });

    // Losing access takes effect immediately: drop their sessions (and with them any live-data sockets).
    const lostAccess =
      (dto.enabled === false && user.enabled) ||
      (dto.accountStatus !== undefined && dto.accountStatus !== 'Active' && user.accountStatus === 'Active');
    if (lostAccess) await this.sessions.revokeAll(id);

    const { deviceId, ...fields } = dto;
    await this.audit.record({
      actorId,
      action: 'user.update',
      targetType: 'user',
      targetId: id,
      meta: {
        changes: fields,
        ...(deviceId ? { claimedDevice: deviceId } : {}),
        before: {
          enabled: user.enabled,
          accountStatus: user.accountStatus,
          paymentStatus: user.paymentStatus,
        },
      },
    });

    return this.toListItem(updated);
  }
}
