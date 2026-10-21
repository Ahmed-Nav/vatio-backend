import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['Active', 'Suspended', 'Pending'])
  accountStatus?: string;

  @IsOptional()
  @IsIn(['Paid', 'Unpaid', 'Overdue'])
  paymentStatus?: string;
}
