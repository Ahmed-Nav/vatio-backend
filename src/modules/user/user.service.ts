import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  private toListItem(user: {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
    address1: string | null;
    address2: string | null;
    enabled: boolean;
    accountStatus: string;
    paymentStatus: string;
    lastLogin: Date | null;
    role: string;
    devices: { id: string }[];
  }) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      address: [user.address1, user.address2].filter(Boolean).join(', ') || null,
      deviceId: user.devices[0]?.id ?? null,
      enabled: user.enabled,
      accountStatus: user.accountStatus,
      paymentStatus: user.paymentStatus,
      lastLogin: user.lastLogin,
      role: user.role,
    };
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
      where: { role: { not: 'admin' } },
      include: { devices: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return users.map((u) => this.toListItem(u));
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { devices: { select: { id: true } } },
    });
    if (!user) throw new NotFoundException('User not found');

    if (dto.deviceId) {
      // Device.ownerId is required, so "editing" a user's device means
      // (re)assigning the given device to this user — same semantics as
      // claiming a device at registration. An admin revokes a device from
      // this user by reassigning it to someone else via that someone else's
      // own Edit Device ID action.
      const device = await this.prisma.device.findUnique({
        where: { id: dto.deviceId },
      });
      if (!device) throw new NotFoundException('Invalid Device ID');
      await this.prisma.device.update({
        where: { id: dto.deviceId },
        data: { ownerId: id },
      });
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.accountStatus !== undefined && {
          accountStatus: dto.accountStatus,
        }),
        ...(dto.paymentStatus !== undefined && {
          paymentStatus: dto.paymentStatus,
        }),
      },
      include: { devices: { select: { id: true } } },
    });

    return this.toListItem(updated);
  }
}
