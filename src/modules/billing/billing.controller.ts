import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import { AllowRestricted } from '../access/access.service';
import { BillingService } from './billing.service';
import { CreateOrderDto } from './dto/billing.dto';
import { PAYMENT_GATEWAY, type PaymentGateway } from './payment-gateway';
import { PrismaService } from '../../prisma/prisma.service';

// Suspended users must still be able to open Billing and pay, so the whole controller is exempt
// from the "no data for suspended accounts" guard.
@AllowRestricted()
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  @Get('plans')
  plans() {
    return this.billing.listPlans();
  }

  @Get('me')
  me(@Req() req) {
    return this.billing.getMyBilling(req.user.userId);
  }

  @Post('orders')
  @HttpCode(HttpStatus.OK)
  createOrder(@Req() req, @Body() dto: CreateOrderDto) {
    return this.billing.createOrder(req.user.userId, dto.planId);
  }

  /**
   * Gateway -> backend. Public (no session or CSRF), so the HMAC signature on the raw body
   * is the only thing that proves it came from the gateway.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: RawBodyRequest<FastifyRequest>,
    @Headers('x-razorpay-signature') signature?: string,
  ) {
    if (!req.rawBody) throw new ForbiddenException('Missing body');
    const event = this.gateway.parseWebhook(req.rawBody, signature);
    if (!event) throw new ForbiddenException('Invalid signature');
    await this.billing.handleGatewayEvent(event);
    return { received: true };
  }

  /** Development only, stub gateway only: completes an order without taking any money. */
  @Post('dev/confirm')
  @HttpCode(HttpStatus.OK)
  async devConfirm(@Req() req, @Body() body: { orderId: string }) {
    if (process.env.NODE_ENV === 'production' || this.gateway.name !== 'stub') {
      throw new NotFoundException();
    }
    const payment = await this.prisma.payment.findUnique({ where: { gatewayOrderId: body.orderId } });
    if (!payment || payment.userId !== req.user.userId) throw new NotFoundException('Order not found');
    await this.billing.applyPaid(body.orderId, `stub_pay_${Date.now()}`, payment.amount * 100);
    return { confirmed: true };
  }
}
