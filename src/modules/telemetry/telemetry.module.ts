import { Module } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { RedisProvider } from './redis.provider';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AggregationService } from './aggregation.service';

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
  ],
  providers: [RedisProvider, TelemetryService, AggregationService],
  controllers: [TelemetryService],
  exports: [TelemetryService],
})
export class TelemetryModule { }