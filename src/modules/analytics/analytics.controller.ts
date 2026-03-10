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
}