import { IsBoolean, IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateUserDto {
  // Claims this device for the user (a user can own several; use PATCH /devices/:id/owner to unassign)
  @IsOptional()
  @IsString()
  deviceId?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['Active', 'Suspended', 'Pending'])
  accountStatus?: string;

  @IsOptional()
  @IsIn(['Paid', 'Unpaid', 'Overdue', 'Pending'])
  paymentStatus?: string;

  // Admin "extend due date"
  @IsOptional()
  @IsDateString()
  paidUntil?: string;

  @IsOptional()
  @IsString()
  planId?: string;
}
