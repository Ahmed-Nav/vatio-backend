import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // for SessionService (sign a user out when they're suspended)
  providers: [UserService],
  controllers: [UserController],
})
export class UserModule {}
