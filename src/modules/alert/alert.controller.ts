import { Controller, Get, Req } from '@nestjs/common';
import { AlertService } from './alert.service';

@Controller('alerts')
export class AlertController {
    constructor(private readonly alertService: AlertService) { }

    @Get()
    async getAlerts(@Req() req) {
        return this.alertService.getAlerts(req.user.userId);
    }
}
