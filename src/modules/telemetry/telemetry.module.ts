import { Module } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { RedisProvider } from './redis.provider';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AggregationService } from './aggregation.service';
import { TelemetryGateway } from './telemetry.gateway';
import { TelemetryController } from './telemetry.controller';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { AuthModule } from '../auth/auth.module';

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
    AuthModule
  ],
  providers: [RedisProvider, TelemetryService, AggregationService, TelemetryGateway, WsJwtGuard],
  controllers: [TelemetryController],
  exports: [TelemetryService],
})
export class TelemetryModule { }