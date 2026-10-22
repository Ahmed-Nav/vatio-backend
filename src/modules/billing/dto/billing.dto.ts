import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  planId: string;
}

export class MarkPaidDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @IsOptional()
  @IsString()
  planId?: string;
}

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  durationDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  badge?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateBillingSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  overdueAfterDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(180)
  suspendAfterDays?: number;
}
