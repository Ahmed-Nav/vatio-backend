import { IsOptional, IsString } from 'class-validator';

export class AssignOwnerDto {
    // null / missing = unassign the device
    @IsOptional()
    @IsString()
    userId?: string | null;
}
