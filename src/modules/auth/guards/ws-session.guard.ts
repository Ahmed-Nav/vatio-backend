import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { getSessionCookieName } from '../session.config';
import { SessionService, type SessionUser } from '../session.service';

export interface VatioSocketData {
  user?: SessionUser;
  sessionId?: string;
  sessionToken?: string;
}

export type VatioSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  VatioSocketData
>;

export function getCookieValue(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === name) return decodeURIComponent(valueParts.join('='));
  }
  return undefined;
}

@Injectable()
export class WsSessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext) {
    const client = context.switchToWs().getClient<VatioSocket>();
    const token = getCookieValue(
      client.handshake.headers.cookie,
      getSessionCookieName(),
    );
    const session = await this.sessions.validate(token);
    if (!session) throw new WsException('Unauthorized');
    client.data.user = session.user;
    client.data.sessionId = session.sessionId;
    client.data.sessionToken = token;
    return true;
  }
}
