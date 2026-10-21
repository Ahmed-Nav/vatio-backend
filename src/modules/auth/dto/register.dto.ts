import { IsEmail, IsNotEmpty, IsOptional, MinLength } from 'class-validator';

export class RegisterDto {
  @IsNotEmpty()
  name: string;

  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsNotEmpty()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;

  @IsOptional()
  phone?: string;

  @IsOptional()
  address1?: string;

  @IsOptional()
  address2?: string;

  @IsOptional()
  city?: string;

  @IsOptional()
  pincode?: string;

  @IsOptional()
  deviceId?: string;
}
