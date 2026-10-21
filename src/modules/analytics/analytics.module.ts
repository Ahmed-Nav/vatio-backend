import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { EnergyCalculationService } from './energy-calculation.service';

@Module({
  providers: [AnalyticsService, EnergyCalculationService],
  controllers: [AnalyticsController]
})
export class AnalyticsModule {}
