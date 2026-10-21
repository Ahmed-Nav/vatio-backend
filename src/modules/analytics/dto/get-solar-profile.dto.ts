import { IsString, IsNotEmpty, IsOptional, IsDateString, IsIn } from 'class-validator';

export class GetSolarProfileDto {
    @IsString()
    @IsNotEmpty()
    deviceId: string;

    @IsDateString()
    @IsNotEmpty()
    start: string;

    @IsDateString()
    @IsNotEmpty()
    end: string;

    @IsOptional()
    @IsIn(['hourly', 'daily', 'monthly'])
    type?: string = 'hourly';
}
