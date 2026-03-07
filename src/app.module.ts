import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    BullModule.forRoot({
      connection: getRedisConfig(),
    }),
    TelemetryModule,
    PrismaModule,
    AuthModule,
    AnalyticsModule,
    DeviceModule,
    AlertModule,
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
