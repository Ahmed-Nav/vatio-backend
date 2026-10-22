import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateDeviceDto {
    @IsString()
    @IsNotEmpty()
    id: string;

    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsOptional()
    location?: string;

    // Optional: assign to a customer right away; otherwise the device starts unassigned
    @IsString()
    @IsOptional()
    ownerId?: string;
}