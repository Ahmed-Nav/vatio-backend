import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  Get,
  Header,
  Put,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { Public } from './decorators/public.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AllowRestricted } from '../access/access.service';
import { SessionService } from './session.service';
import {
  getSessionCookieClearOptions,
  getSessionCookieName,
  getSessionCookieOptions,
} from './session.config';
import type { SessionRecord, SessionUser } from './session.service';

type AuthenticatedRequest = FastifyRequest & {
  user: SessionUser;
  vatioSession: SessionRecord;
  vatioSessionToken: string;
};

interface RequestWithHeaders {
  headers: Record<string, string | string[] | undefined>;
}

@AllowRestricted()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Post('login')
  async signIn(@Body() signInDto: LoginDto) {
    return this.authService.login(signInDto.email, signInDto.password);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Post('verify-otp')
  async verifyOtp(
    @Body() verifyOtpDto: VerifyOtpDto,
    @Req() req: RequestWithHeaders,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.authService.verifyOtp(
      verifyOtpDto.email,
      verifyOtpDto.otp,
      Array.isArray(req.headers['user-agent'])
        ? req.headers['user-agent'][0]
        : req.headers['user-agent'],
    );
    reply.setCookie(
      getSessionCookieName(),
      result.sessionToken,
      getSessionCookieOptions(),
    );
    return {
      user: result.user,
      csrfToken: result.csrfToken,
      expiresAt: result.expiresAt,
    };
  }

  @Get('session')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async getSession(@Req() req: AuthenticatedRequest) {
    return {
      user: await this.authService.getProfile(req.user.userId),
      csrfToken: this.sessions.getCsrfToken(req.vatioSession.sessionId),
      expiresAt: new Date(req.vatioSession.absoluteExpiresAt).toISOString(),
    };
  }

  @Put('profile')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  updateProfile(@Req() req: AuthenticatedRequest, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.userId, dto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  changePassword(@Req() req: AuthenticatedRequest, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(
      req.user.userId,
      dto.currentPassword,
      dto.newPassword,
      req.vatioSessionToken,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.sessions.revoke(req.vatioSessionToken);
    reply.clearCookie(getSessionCookieName(), getSessionCookieClearOptions());
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.sessions.revokeAll(req.user.userId);
    reply.clearCookie(getSessionCookieName(), getSessionCookieClearOptions());
  }
}
