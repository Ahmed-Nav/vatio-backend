import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { AuditService } from '../audit/audit.service';
import { assertDeviceEnabled } from '../access/access.service';

@Injectable()
export class DeviceService {
    constructor(
        private prisma: PrismaService,
        private readonly audit: AuditService,
    ) { }

    private notFound(deviceId: string) {
        return new NotFoundException({
            code: 'DEVICE_NOT_FOUND',
            message: `Device with ID '${deviceId}' not found`,
            timestamp: new Date().toISOString(),
        });
    }

    // Admin only (enforced in the controller)
    async create(actorId: string, dto: CreateDeviceDto) {
        const exists = await this.prisma.device.findUnique({ where: { id: dto.id } });
        if (exists) throw new ConflictException('Device ID already registered');

        if (dto.ownerId) {
            const owner = await this.prisma.user.findUnique({ where: { id: dto.ownerId }, select: { id: true } });
            if (!owner) throw new NotFoundException('Owner not found');
        }

        const device = await this.prisma.device.create({
            data: {
                id: dto.id,
                name: dto.name,
                location: dto.location,
                ownerId: dto.ownerId ?? null,
            },
        });
        await this.audit.record({
            actorId,
            action: 'device.create',
            targetType: 'device',
            targetId: device.id,
            meta: { ownerId: device.ownerId },
        });
        return device;
    }

    async findAll(ownerId: string, role?: string) {
        return this.prisma.device.findMany({
            where: role === 'admin' ? {} : { ownerId },
            orderBy: { createdAt: 'asc' },
        });
    }

    async findOne(ownerId: string, deviceId: string, role?: string) {
        const device = await this.prisma.device.findFirst({
            where: role === 'admin' ? { id: deviceId } : { id: deviceId, ownerId },
        });
        if (!device) throw this.notFound(deviceId);
        assertDeviceEnabled(device, role);
        return device;
    }

    // Admin only
    async update(actorId: string, deviceId: string, dto: UpdateDeviceDto) {
        const existing = await this.prisma.device.findUnique({ where: { id: deviceId } });
        if (!existing) throw this.notFound(deviceId);

        const device = await this.prisma.device.update({
            where: { id: deviceId },
            data: dto,
        });
        await this.audit.record({
            actorId,
            action: dto.enabled === undefined ? 'device.update' : dto.enabled ? 'device.enable' : 'device.disable',
            targetType: 'device',
            targetId: deviceId,
            meta: { changes: dto },
        });
        return device;
    }

    // Admin only: move a device to a customer, or unassign it with userId = null
    async setOwner(actorId: string, deviceId: string, userId: string | null | undefined) {
        const existing = await this.prisma.device.findUnique({ where: { id: deviceId } });
        if (!existing) throw this.notFound(deviceId);

        if (userId) {
            const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
            if (!user) throw new NotFoundException('User not found');
        }

        const device = await this.prisma.device.update({
            where: { id: deviceId },
            data: { ownerId: userId || null },
        });
        await this.audit.record({
            actorId,
            action: 'device.assign',
            targetType: 'device',
            targetId: deviceId,
            meta: { from: existing.ownerId, to: device.ownerId },
        });
        return device;
    }

    // Admin only. Readings and alerts reference the device, so they go first.
    async remove(actorId: string, deviceId: string) {
        const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
        if (!device) throw this.notFound(deviceId);

        await this.prisma.$transaction([
            this.prisma.telemetry.deleteMany({ where: { deviceId } }),
            this.prisma.alert.deleteMany({ where: { deviceId } }),
            this.prisma.device.delete({ where: { id: deviceId } }),
        ]);
        await this.audit.record({
            actorId,
            action: 'device.delete',
            targetType: 'device',
            targetId: deviceId,
            meta: { name: device.name, ownerId: device.ownerId },
        });
        return { success: true };
    }
}
