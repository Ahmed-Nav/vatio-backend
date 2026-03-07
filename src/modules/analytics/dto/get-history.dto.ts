import { IsString, IsNotEmpty, IsOptional, IsEnum, IsDateString } from 'class-validator';

export enum BucketInterval {
    ONE_MIN = '1m',
    FIVE_MIN = '5m',
    ONE_HOUR = '1h',
}

export class GetHistoryDto {
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
    @IsEnum(BucketInterval)
    interval?: BucketInterval = BucketInterval.FIVE_MIN;
}