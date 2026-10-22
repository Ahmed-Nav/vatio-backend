import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Global,
  Injectable,
  Module,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import type { SessionUser } from '../auth/session.service';

export const ALLOW_RESTRICTED_KEY = 'allowRestricted';
/** Routes a suspended/pending user still needs (login session, profile, billing). */
export const AllowRestricted = () => SetMetadata(ALLOW_RESTRICTED_KEY, true);

export const ACCOUNT_ACTIVE = 'Active';

/** Non-admins can't read data from a device the admin has switched off. */
export function assertDeviceEnabled(device: { enabled: boolean }, role?: string) {
  if (role !== 'admin' && !device.enabled) {
    throw new ForbiddenException({
      code: 'DEVICE_DISABLED',
      message: 'This device has been disabled by your administrator.',
    });
  }
}

interface AccountFlags {
  enabled: boolean;
  accountStatus: string;
}

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Throws 403 unless the user may see device data. Admins always may. */
  async assertDataAccess(userId: string, role?: string) {
    if (role === 'admin') return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { enabled: true, accountStatus: true },
    });
    this.assertFlags(user);
  }

  assertFlags(user: AccountFlags | null) {
    if (!user || !user.enabled) {
      throw new ForbiddenException({
        code: 'ACCOUNT_DISABLED',
        message: 'Your account has been disabled. Contact your administrator.',
      });
    }
    if (user.accountStatus === 'Pending') {
      throw new ForbiddenException({
        code: 'ACCOUNT_PENDING',
        message: 'Your account is waiting for admin approval.',
      });
    }
    if (user.accountStatus !== ACCOUNT_ACTIVE) {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account is suspended. Check your billing or contact your administrator.',
      });
    }
  }

  assertDeviceEnabled = assertDeviceEnabled;
}

type AccessRequest = { user?: SessionUser };

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_RESTRICTED_KEY, targets)) return true;

    const user = context.switchToHttp().getRequest<AccessRequest>().user;
    if (!user) return true; // SessionAuthGuard already rejected unauthenticated calls
    await this.access.assertDataAccess(user.userId, user.role);
    return true;
  }
}

@Global()
@Module({
  providers: [AccessService, AccessGuard],
  exports: [AccessService, AccessGuard],
})
export class AccessModule {}
