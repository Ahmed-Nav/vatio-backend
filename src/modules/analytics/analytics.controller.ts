import { Controller, Get, Query, Req } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { GetHistoryDto } from './dto/get-history.dto';
import { GetEnergyDto } from './dto/get-energy.dto';
import { GetSolarProfileDto } from './dto/get-solar-profile.dto';

@Controller('analytics')
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) { }

    @Get('history')
    async getHistory(@Req() req, @Query() query: GetHistoryDto) {
        return this.analyticsService.getDeviceHistory(req.user.userId, query, req.user.role);
    }

    @Get('energy')
    async getEnergy(@Req() req, @Query() query: GetEnergyDto) {
        return this.analyticsService.getEnergyAnalysis(req.user.userId, query, req.user.role);
    }

    @Get('solar-profile')
    async getSolarProfile(@Req() req, @Query() query: GetSolarProfileDto) {
        return this.analyticsService.getSolarProfile(req.user.userId, query, req.user.role);
    }
}