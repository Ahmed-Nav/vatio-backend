import { IsString, IsObject, IsNotEmpty } from 'class-validator';

export class TelemetryDto {
    @IsString()
    @IsNotEmpty()
    deviceId: string;

    @IsObject()
    metrics: Record<string, number>;
}