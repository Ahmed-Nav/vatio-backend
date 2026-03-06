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
                const payload = { sub: user.id, email: user.email };
                return {
                    access_token: this.jwtService.sign(payload),
                };
            }
        }
        throw new UnauthorizedException('Invalid credentials');
    }
}