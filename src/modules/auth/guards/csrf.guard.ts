import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SessionService } from '../session.service';
import type { FastifyRequest } from 'fastify';
import type { SessionRecord } from '../session.service';

type CsrfRequest = FastifyRequest & {
  vatioSession?: SessionRecord;
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<CsrfRequest>();
    if (SAFE_METHODS.has(request.method)) return true;

    const origin = request.headers.origin;
    const allowedOrigins = (
      process.env.ALLOWED_ORIGINS || 'http://localhost:5173'
    )
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (origin && !allowedOrigins.includes(origin)) {
      throw new ForbiddenException('Origin is not allowed');
    }

    const sessionId = request.vatioSession?.sessionId;
    const supplied = request.headers['x-csrf-token'];
    const token = Array.isArray(supplied) ? supplied[0] : supplied;
    if (!sessionId || !this.sessions.validateCsrfToken(sessionId, token)) {
      throw new ForbiddenException('Invalid CSRF token');
    }
    return true;
  }
}
