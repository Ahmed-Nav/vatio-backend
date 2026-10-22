import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../telemetry/redis.provider';
import * as bcrypt from 'bcrypt';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { SessionService } from './session.service';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuditService } from '../audit/audit.service';

const OTP_TTL_SECONDS = 300; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 30;

interface OtpRecord {
  digest: string;
  attempts: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private readonly sessions: SessionService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly audit: AuditService,
  ) {}

  /** Hard-disabled accounts can't sign in at all. Suspended/pending ones can (to pay), but see no data. */
  private assertNotDisabled(user: { enabled: boolean; role: string }) {
    if (user.role !== 'admin' && !user.enabled) {
      throw new ForbiddenException({
        code: 'ACCOUNT_DISABLED',
        message: 'Your account has been disabled. Contact your administrator.',
      });
    }
  }

  private otpKey(email: string) {
    return `vatio:otp:${email.toLowerCase().trim()}`;
  }

  private otpCooldownKey(email: string) {
    return `vatio:otp-cooldown:${email.toLowerCase().trim()}`;
  }

  private otpDigest(email: string, otp: string) {
    const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || '';
    if (!secret)
      throw new Error('SESSION_SECRET or JWT_SECRET must be configured');
    return createHmac('sha256', secret)
      .update(`${email.toLowerCase().trim()}:${otp}`)
      .digest('hex');
  }

  private otpMatches(expected: string, actual: string) {
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    return (
      expectedBuffer.length === actualBuffer.length &&
      timingSafeEqual(expectedBuffer, actualBuffer)
    );
  }

  async login(email: string, pass: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !(await bcrypt.compare(pass, user.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    this.assertNotDisabled(user);

    return this.issueOtp(email);
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    if (dto.deviceId) {
      const device = await this.prisma.device.findUnique({
        where: { id: dto.deviceId },
      });
      if (!device) {
        throw new NotFoundException('Invalid Device ID');
      }
      // A device that already has an owner can only be re-assigned by an admin.
      if (device.ownerId) {
        throw new ConflictException('This device is already registered to another account');
      }
    }

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hashed,
        phone: dto.phone,
        address1: dto.address1,
        address2: dto.address2,
        city: dto.city,
        pincode: dto.pincode,
        // New sign-ups wait for admin approval before they can see any data.
        accountStatus: 'Pending',
        paymentStatus: 'Pending',
      },
    });

    if (dto.deviceId) {
      // updateMany + ownerId:null makes the claim atomic if two people race for one device.
      const claimed = await this.prisma.device.updateMany({
        where: { id: dto.deviceId, ownerId: null },
        data: { ownerId: user.id },
      });
      if (claimed.count === 0) {
        await this.prisma.user.delete({ where: { id: user.id } });
        throw new ConflictException('This device is already registered to another account');
      }
    }

    return this.issueOtp(dto.email);
  }

  private async issueOtp(email: string) {
    const cooldown = await this.redis.set(
      this.otpCooldownKey(email),
      '1',
      'EX',
      OTP_RESEND_COOLDOWN_SECONDS,
      'NX',
    );
    if (!cooldown) {
      throw new HttpException(
        'Please wait before requesting another OTP',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otp = String(randomInt(1000, 10000));
    const record: OtpRecord = {
      digest: this.otpDigest(email, otp),
      attempts: 0,
    };
    await this.redis.set(
      this.otpKey(email),
      JSON.stringify(record),
      'EX',
      OTP_TTL_SECONDS,
    );

    // No SMS/email provider is wired yet. Never expose OTPs in production logs.
    if (process.env.NODE_ENV !== 'production') {
      const reset = '\x1b[0m';
      const bold = '\x1b[1m';
      const bgYellow = '\x1b[1;43;30m';
      const brightYellow = '\x1b[1;93m';
      const cyan = '\x1b[36m';
      const dim = '\x1b[2m';
      const border = '\x1b[33m';

      const padBox = (content: string, width = 56) => {
        const visible = content.replace(/\x1b\[[0-9;]*m/g, '');
        return content + ' '.repeat(Math.max(0, width - visible.length));
      };

      const box = [
        '',
        `${border}┌────────────────────────────────────────────────────────┐${reset}`,
        `${border}│${reset}${padBox(`  🔐 ${bgYellow} DEV LOGIN OTP ${reset}`)}${border}│${reset}`,
        `${border}│${reset}${padBox(`  Account : ${cyan}${email}${reset}`)}${border}│${reset}`,
        `${border}│${reset}${padBox(`  OTP     : ${brightYellow}${bold}>>> [ ${otp} ] <<<${reset}`)}${border}│${reset}`,
        `${border}│${reset}${padBox(`  Expires : ${dim}${OTP_TTL_SECONDS}s (5 minutes)${reset}`)}${border}│${reset}`,
        `${border}└────────────────────────────────────────────────────────┘${reset}`,
        '',
      ].join('\n');

      console.log(box);

      // Testing aid only: never returned in production.
      return { message: 'OTP sent', devOtp: otp };
    }

    return { message: 'OTP sent' };
  }

  async verifyOtp(email: string, otp: string, userAgent?: string) {
    const key = this.otpKey(email);
    const stored = await this.redis.get(key);

    if (!stored) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    let record: OtpRecord;
    try {
      record = JSON.parse(stored) as OtpRecord;
    } catch {
      await this.redis.del(key);
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    if (!this.otpMatches(record.digest, this.otpDigest(email, otp))) {
      record.attempts += 1;
      if (record.attempts >= OTP_MAX_ATTEMPTS) {
        await this.redis.del(key);
      } else {
        const ttl = await this.redis.ttl(key);
        if (ttl > 0) {
          await this.redis.set(key, JSON.stringify(record), 'EX', ttl);
        }
      }
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    await this.redis.del(key);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    this.assertNotDisabled(user);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const session = await this.sessions.create(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      userAgent,
    );
    return {
      sessionToken: session.token,
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.record.absoluteExpiresAt).toISOString(),
      user: await this.getProfile(user.id),
    };
  }

  /** Fresh profile + billing summary for the signed-in user (the session only holds a snapshot). */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        plan: true,
        devices: { select: { id: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!user) throw new UnauthorizedException('Session expired or invalid');
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone,
      address1: user.address1,
      address2: user.address2,
      city: user.city,
      pincode: user.pincode,
      enabled: user.enabled,
      accountStatus: user.accountStatus,
      paymentStatus: user.paymentStatus,
      paidUntil: user.paidUntil,
      plan: user.plan
        ? { id: user.plan.id, name: user.plan.name, period: user.plan.period, amount: user.plan.amount }
        : null,
      lastLogin: user.lastLogin,
      deviceId: user.devices[0]?.id ?? null,
      deviceIds: user.devices.map((d) => d.id),
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data = Object.fromEntries(
      Object.entries(dto).filter(([, v]) => v !== undefined),
    ) as UpdateProfileDto;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to update');
    }
    if (data.name !== undefined && !data.name.trim()) {
      throw new BadRequestException('Name is required');
    }
    await this.prisma.user.update({ where: { id: userId }, data });
    return { user: await this.getProfile(userId) };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionToken?: string,
  ) {
    // Slow down guessing of the current password: 5 wrong attempts per 15 minutes.
    const key = `vatio:pwchange-fail:${userId}`;
    const fails = Number((await this.redis.get(key)) || 0);
    if (fails >= 5) {
      throw new HttpException(
        'Too many incorrect attempts. Try again in a few minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Session expired or invalid');

    if (!(await bcrypt.compare(currentPassword, user.password))) {
      await this.redis.multi().incr(key).expire(key, 15 * 60).exec();
      throw new BadRequestException('Your current password is incorrect');
    }
    if (await bcrypt.compare(newPassword, user.password)) {
      throw new BadRequestException('Choose a password different from your current one');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(newPassword, 10) },
    });
    await this.redis.del(key);
    // Anyone else signed in with the old password is signed out; this session stays.
    await this.sessions.revokeOthers(userId, currentSessionToken);
    await this.audit.record({
      actorId: userId,
      action: 'auth.change_password',
      targetType: 'user',
      targetId: userId,
    });
    return { message: 'Password changed' };
  }
}
