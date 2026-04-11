import { Controller, Get, Param } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';
import { TelemetryService } from './telemetry.service';
import { TelemetryDto } from './dto/telemetry.dto';
import { Public } from '../auth/decorators/public.decorator';

@Controller('telemetry')
export class TelemetryController {
    constructor(private readonly telemetryService: TelemetryService) { }

    @Public()
    @MessagePattern('vatio/+/rs485')
    async handleTelemetry(@Payload() data: any, @Ctx() context: MqttContext) {
        // Extract deviceId from topic: 'vatio/<deviceId>/rs485'
        const topic = context.getTopic();
        const parts = topic.split('/');
        const deviceId = parts[1];

        console.log(`\n--- 🟢 DEVICE ALIVE: [${deviceId}] RECEIVED MQTT DATA ---`);
        console.log(data);
        console.log('-------------------------------------------\n');

        // Inject the deviceId from the topic into the data object
        data.deviceId = deviceId;
        
        return this.telemetryService.ingestData(data as TelemetryDto);
    }

    @Get(':deviceId/latest')
    async getLatest(@Param('deviceId') deviceId: string) {
        return this.telemetryService.getLatest(deviceId);
    }

    @Get(':deviceId/activity')
    async getActivity(@Param('deviceId') deviceId: string) {
        return this.telemetryService.getActivityLog(deviceId);
    }
}