import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateDeviceDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    location?: string;

    @IsString()
    @IsOptional()
    status?: string;

    // Admin switch: a disabled device stops streaming and is hidden from its owner's data views
    @IsBoolean()
    @IsOptional()
    enabled?: boolean;
}
