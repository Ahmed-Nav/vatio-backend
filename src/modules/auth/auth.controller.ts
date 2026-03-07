import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from './decorators/public.decorator';

@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) { }

    @Public()
    @HttpCode(HttpStatus.OK)
    @Post('login')
    async signIn(@Body() signInDto: LoginDto) {
        return this.authService.login(signInDto.email, signInDto.password);
    }

    @UseGuards(JwtAuthGuard)
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    async refresh(@Req() req) {
        return this.authService.refresh(
            req.user.userId,
            req.user.email,
            req.user.role,
        );
    }
}