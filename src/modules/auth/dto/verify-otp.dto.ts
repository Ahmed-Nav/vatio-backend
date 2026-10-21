import { IsEmail, IsNotEmpty, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsNotEmpty()
  @Matches(/^\d{4}$/, { message: 'OTP must be 4 digits' })
  otp: string;
}
