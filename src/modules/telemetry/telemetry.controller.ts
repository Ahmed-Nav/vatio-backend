import { Controller } from '@nestjs/common';
import { Ctx, MessagePattern, MqttContext, Payload } from '@nestjs/microservices';
import { TelemetryService } from './telemetry.service';
import { TelemetryDto } from './dto/telemetry.dto';

@Controller()
export class TelemetryController {
    constructor(private readonly telemetryService: TelemetryService) { }

    @MessagePattern('vatio/+/rs485')
    async handleTelemetry(@Payload() data: TelemetryDto, @Ctx() context: MqttContext) {
        const topic = context.getTopic();
        const topicParts = topic.split('/');
        const deviceId = topicParts[1];
        return this.telemetryService.ingestData(deviceId, data);
    }
    @MessagePattern('vatio/+/status')
    async handleStatus(@Payload() data: any, @Ctx() context: MqttContext) {
        const deviceId = context.getTopic().split('/')[1];
        console.log(`Device ${deviceId} is ${data.status}`);
    }
}