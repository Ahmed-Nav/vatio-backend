import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { BillingService } from './billing.service';
import { MarkPaidDto, UpdateBillingSettingsDto, UpdatePlanDto } from './dto/billing.dto';

@Roles('admin')
@Controller('admin')
export class BillingAdminController {
  constructor(private readonly billing: BillingService) {}

  @Get('payments')
  payments() {
    return this.billing.adminPayments();
  }

  @Post('payments/:userId/mark-paid')
  @HttpCode(HttpStatus.OK)
  markPaid(@Req() req, @Param('userId') userId: string, @Body() dto: MarkPaidDto) {
    return this.billing.markPaidOffline(req.user.userId, userId, dto.note, dto.planId);
  }

  @Get('plans')
  plans() {
    return this.billing.listPlans(true);
  }

  @Patch('plans/:id')
  updatePlan(@Req() req, @Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.billing.updatePlan(req.user.userId, id, dto);
  }

  @Get('billing-settings')
  settings() {
    return this.billing.getSettings();
  }

  @Patch('billing-settings')
  updateSettings(@Req() req, @Body() dto: UpdateBillingSettingsDto) {
    return this.billing.updateSettings(req.user.userId, {
      ...(dto.overdueAfterDays !== undefined && { 'billing.overdueAfterDays': dto.overdueAfterDays }),
      ...(dto.suspendAfterDays !== undefined && { 'billing.suspendAfterDays': dto.suspendAfterDays }),
    });
  }

  /** Run the due/overdue/suspend check now (it also runs every night). */
  @Post('billing/run-sweep')
  @HttpCode(HttpStatus.OK)
  sweep() {
    return this.billing.runDueSweep();
  }
}
