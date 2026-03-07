import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
    ) { }

    async login(email: string, pass: string) {
        const user = await this.prisma.user.findUnique({ where: { email } });

        if (user) {
            const isMatch = await bcrypt.compare(pass, user.password);

            if (isMatch) {
                const payload = { sub: user.id, email: user.email, role: user.role };
                const token = this.jwtService.sign(payload);
                const decoded = this.jwtService.decode(token) as any;
                return {
                    token,
                    expiresAt: new Date(decoded.exp * 1000).toISOString(),
                };
            }
        }
        throw new UnauthorizedException('Invalid credentials');
    }

    async refresh(userId: string, email: string, role: string) {
        const payload = { sub: userId, email, role };
        const token = this.jwtService.sign(payload);
        const decoded = this.jwtService.decode(token) as any;
        return {
            token,
            expiresAt: new Date(decoded.exp * 1000).toISOString(),
        };
    }
}