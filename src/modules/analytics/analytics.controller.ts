import { Controller, Get, Query, Req } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { GetHistoryDto } from './dto/get-history.dto';

@Controller('analytics')
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) { }

    @Get('history')
    async getHistory(@Req() req, @Query() query: GetHistoryDto) {
        return this.analyticsService.getDeviceHistory(req.user.userId, query);
    }

    @Get('energy')
    async getEnergy(
        @Req() req,
        @Query('deviceId') deviceId: string,
        @Query('type') type: 'hourly' | 'daily' | 'monthly',
        @Query('start') start?: string,
        @Query('end') end?: string
    ) {
        return this.analyticsService.getEnergyAnalysis(req.user.userId, deviceId, type, start, end);
    }

    @Get('solar-profile')
    async getSolarProfile(@Req() req, @Query('deviceId') deviceId: string) {
        return this.analyticsService.getSolarGridProfile(req.user.userId, deviceId);
    }
}