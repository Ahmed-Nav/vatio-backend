import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { getSessionCookieName } from '../session.config';
import { SessionService } from '../session.service';
import type { FastifyRequest } from 'fastify';
import type { SessionRecord, SessionUser } from '../session.service';

type SessionRequest = FastifyRequest & {
  cookies: Record<string, string | undefined>;
  user?: SessionUser;
  vatioSession?: SessionRecord;
  vatioSessionToken?: string;
};

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<SessionRequest>();
    const token = request.cookies?.[getSessionCookieName()];
    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthorizedException('Session expired or invalid');

    request.user = session.user;
    request.vatioSession = session;
    request.vatioSessionToken = token;
    return true;
  }
}
