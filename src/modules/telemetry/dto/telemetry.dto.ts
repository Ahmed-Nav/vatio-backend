import { IsString, IsObject, IsOptional } from 'class-validator';

export class TelemetryDto {
    @IsString()
    @IsOptional()
    deviceId?: string;

    @IsObject()
    @IsOptional()
    metrics?: Record<string, any>;

    [key: string]: any;
}