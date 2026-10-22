import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { BillingAdminController } from './billing-admin.controller';
import { BILLING_QUEUE, BillingProcessor } from './billing.processor';
import { PAYMENT_GATEWAY, createGatewayFromEnv } from './payment-gateway';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, BullModule.registerQueue({ name: BILLING_QUEUE })],
  providers: [
    BillingService,
    BillingProcessor,
    { provide: PAYMENT_GATEWAY, useFactory: createGatewayFromEnv },
  ],
  controllers: [BillingController, BillingAdminController],
  exports: [BillingService],
})
export class BillingModule {}
