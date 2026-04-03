import { IsString, IsObject, IsNotEmpty, IsOptional } from 'class-validator';

export class TelemetryDto {
    @IsString()
    @IsNotEmpty()
    deviceId: string;

    @IsObject()
    @IsOptional()
    metrics: Record<string, number>;
}