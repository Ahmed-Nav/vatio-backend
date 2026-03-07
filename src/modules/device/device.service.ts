import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

@Injectable()
export class DeviceService {
    constructor(private prisma: PrismaService) { }

    async create(ownerId: string, dto: CreateDeviceDto) {
        // Check if device ID already exists globally
        const exists = await this.prisma.device.findUnique({ where: { id: dto.id } });
        if (exists) throw new ConflictException('Device ID already registered');

        return this.prisma.device.create({
            data: {
                ...dto,
                ownerId,
            },
        });
    }

    async findAll(ownerId: string) {
        return this.prisma.device.findMany({
            where: { ownerId },
        });
    }

    async findOne(ownerId: string, deviceId: string) {
        const device = await this.prisma.device.findFirst({
            where: { id: deviceId, ownerId },
        });
        if (!device) {
            throw new NotFoundException({
                code: 'DEVICE_NOT_FOUND',
                message: `Device with ID '${deviceId}' not found`,
                timestamp: new Date().toISOString(),
            });
        }
        return device;
    }

    async update(ownerId: string, deviceId: string, dto: UpdateDeviceDto) {
        // Verify ownership first
        await this.findOne(ownerId, deviceId);
        return this.prisma.device.update({
            where: { id: deviceId },
            data: dto,
        });
    }

    async remove(ownerId: string, deviceId: string) {
        const device = await this.prisma.device.findFirst({
            where: { id: deviceId, ownerId }
        });

        if (!device) {
            throw new NotFoundException('Device not found or unauthorized');
        }

        return this.prisma.device.delete({
            where: { id: deviceId }
        });
    }
}