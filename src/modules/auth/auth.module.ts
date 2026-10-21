import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { RedisProvider } from '../telemetry/redis.provider';
import { SessionService } from './session.service';

@Module({
  providers: [AuthService, SessionService, RedisProvider],
  controllers: [AuthController],
  exports: [AuthService, SessionService],
})
export class AuthModule {}
