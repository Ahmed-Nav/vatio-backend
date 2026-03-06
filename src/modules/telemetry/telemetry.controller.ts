import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TelemetryService } from './telemetry.service';
import { TelemetryDto } from './dto/telemetry.dto';

@Controller()
export class TelemetryController {
    constructor(private readonly telemetryService: TelemetryService) { }

    @MessagePattern('vatio/devices/+/telemetry')
    async handleTelemetry(@Payload() data: TelemetryDto) {
        return this.telemetryService.ingestData(data);
    }
}