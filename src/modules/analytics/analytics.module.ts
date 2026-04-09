import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [TelemetryModule, PrismaModule],
  providers: [AnalyticsService],
  controllers: [AnalyticsController]
})
export class AnalyticsModule {}
