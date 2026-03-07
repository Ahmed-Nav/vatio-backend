import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AlertService {
    constructor(private prisma: PrismaService) { }

    async getAlerts(userId: string) {
        return this.prisma.alert.findMany({
            where: {
                device: { ownerId: userId },
                acknowledged: false,
            },
            orderBy: { createdAt: 'desc' },
        });
    }
}
