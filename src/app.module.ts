import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BullModule } from '@nestjs/bullmq';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { getRedisConfig } from './config/redis.config';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { DeviceModule } from './modules/device/device.module';
import { AlertModule } from './modules/alert/alert.module';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';

import { RedisModule } from './modules/redis/redis.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: getRedisConfig(),
    }),
    PrismaModule,
    RedisModule,
    TelemetryModule,
    AuthModule,
    AnalyticsModule,
    DeviceModule,
    AlertModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule { }
