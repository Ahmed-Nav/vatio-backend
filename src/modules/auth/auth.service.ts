import { Injectable, UnauthorizedException, ConflictException, Logger, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        @Inject('REDIS_CLIENT') private readonly redis: Redis,
    ) { }

    // ─── Login ─────────────────────────────────────────────────────
    async login(email: string, pass: string) {
        const user = await this.prisma.user.findUnique({ where: { email } });

        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const isMatch = await bcrypt.compare(pass, user.password);
        if (!isMatch) {
            throw new UnauthorizedException('Invalid credentials');
        }

        // Set default OTP to 1234 for testing (as requested)
        const otp = '1234';

        // Store OTP in Redis with 5-minute TTL
        const redisKey = `otp:${email}`;
        await this.redis.set(redisKey, otp, 'EX', 300);

        this.logger.log(`📧 OTP for ${email}: ${otp}`);

        return {
            message: 'OTP sent successfully',
            email,
        };
    }

    // ─── Verify OTP ────────────────────────────────────────────────
    async verifyOtp(email: string, otp: string) {
        const redisKey = `otp:${email}`;
        const storedOtp = await this.redis.get(redisKey);

        if (!storedOtp) {
            throw new UnauthorizedException('OTP expired or not found. Please login again.');
        }

        if (storedOtp !== otp) {
            throw new UnauthorizedException('Invalid OTP');
        }

        // OTP is valid — delete it so it can't be reused
        await this.redis.del(redisKey);

        // Fetch user and issue JWT
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        const payload = { sub: user.id, email: user.email, role: user.role };
        const access_token = this.jwtService.sign(payload);
        const decoded = this.jwtService.decode(access_token) as any;

        this.logger.log(`✅ OTP verified for ${email} — JWT issued`);

        return {
            token: access_token,
            access_token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
            },
            expiresAt: new Date(decoded.exp * 1000).toISOString(),
        };
    }

    // ─── Register ──────────────────────────────────────────────────
    async register(email: string, name: string, password: string) {
        const existing = await this.prisma.user.findUnique({ where: { email } });
        if (existing) {
            throw new ConflictException('Email already registered');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await this.prisma.user.create({
            data: { email, name, password: hashedPassword },
        });

        // Set default OTP to 1234 for testing (as requested)
        const otp = '1234';
        await this.redis.set(`otp:${email}`, otp, 'EX', 300);

        this.logger.log(`📧 Registration OTP for ${email}: ${otp}`);

        return {
            message: 'Registration successful. OTP sent.',
            email: user.email,
        };
    }

    // ─── Refresh ───────────────────────────────────────────────────
    async refresh(userId: string, email: string, role: string) {
        const payload = { sub: userId, email, role };
        const access_token = this.jwtService.sign(payload);
        const decoded = this.jwtService.decode(access_token) as any;
        return {
            access_token,
            expiresAt: new Date(decoded.exp * 1000).toISOString(),
        };
    }
}