import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { GetHistoryDto } from './dto/get-history.dto';

@Controller('analytics')
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) { }

    @Get('history')
    async getHistory(@Query() query: GetHistoryDto) {
        return this.analyticsService.getDeviceHistory(query);
    }
}