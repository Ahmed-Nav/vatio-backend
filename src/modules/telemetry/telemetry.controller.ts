import { Controller, Get, Param } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TelemetryService } from './telemetry.service';
import { TelemetryDto } from './dto/telemetry.dto';
import { Public } from '../auth/decorators/public.decorator';

@Controller('telemetry')
export class TelemetryController {
    constructor(private readonly telemetryService: TelemetryService) { }

    @Public()
    @MessagePattern('vatio/+/rs485')
    async handleTelemetry(@Payload() data: any) {
        console.log('\n--- 🟢 DEVICE ALIVE: RECEIVED MQTT DATA ---');
        console.log(data);
        console.log('-------------------------------------------\n');
        // Let it run through the rest of the flow (it might fail validation later, but we just want to see it alive)
        return this.telemetryService.ingestData(data as TelemetryDto);
    }

    @Get(':deviceId/latest')
    async getLatest(@Param('deviceId') deviceId: string) {
        return this.telemetryService.getLatest(deviceId);
    }
}