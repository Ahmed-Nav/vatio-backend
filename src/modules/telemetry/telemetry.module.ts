import { Module } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AggregationService } from './aggregation.service';
import { TelemetryGateway } from './telemetry.gateway';
import { TelemetryController } from './telemetry.controller';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { AuthModule } from '../auth/auth.module';
import { BatchPersistenceService } from './batch-persistence.service';
import { RetentionService } from './retention.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'MQTT_SERVICE',
        transport: Transport.MQTT,
        options: {
          url: process.env.MQTT_URL || 'mqtt://localhost:1883',
        },
      },
    ]),
    AuthModule,
    PrismaModule
  ],
  providers: [TelemetryService, AggregationService, TelemetryGateway, WsJwtGuard, BatchPersistenceService, RetentionService],
  controllers: [TelemetryController],
  exports: [TelemetryService],
})
export class TelemetryModule { }