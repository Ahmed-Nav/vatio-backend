import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import type { Namespace } from 'socket.io';
import {
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UseGuards,
} from '@nestjs/common';
import {
  WsSessionGuard,
  type VatioSocket,
  getCookieValue,
} from '../auth/guards/ws-session.guard';
import { SessionService } from '../auth/session.service';
import { getSessionCookieName } from '../auth/session.config';
import { PrismaService } from '../../prisma/prisma.service';
import type { TelemetryUpdate } from './interfaces/telemetry.interface';
import { AccessService } from '../access/access.service';

@WebSocketGateway({
  cors: {
    origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  },
  namespace: 'telemetry',
})
export class TelemetryGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer() server: Namespace;
  private readonly logger = new Logger(TelemetryGateway.name);

  private sessionAuditTimer?: NodeJS.Timeout;

  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  onModuleInit() {
    this.sessionAuditTimer = setInterval(() => {
      void this.disconnectExpiredSessions();
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.sessionAuditTimer) clearInterval(this.sessionAuditTimer);
  }

  private async disconnectExpiredSessions() {
    if (!this.server) return;
    for (const socket of this.server.sockets.values()) {
      const client = socket as VatioSocket;
      const valid = await this.sessions.validate(
        client.data.sessionToken,
        false,
      );
      if (!valid) client.disconnect(true);
    }
  }

  async handleConnection(client: VatioSocket) {
    try {
      const token = getCookieValue(
        client.handshake.headers.cookie,
        getSessionCookieName(),
      );
      const session = await this.sessions.validate(token);
      if (!session) throw new Error('Invalid session');
      client.data.user = session.user;
      client.data.sessionId = session.sessionId;
      client.data.sessionToken = token;
      this.logger.log(`Authenticated client connected: ${client.id}`);
    } catch {
      this.logger.warn(`Unauthenticated connection rejected: ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: VatioSocket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // Allow users to join a specific device's data room
  @UseGuards(WsSessionGuard)
  @SubscribeMessage('joinDevice')
  async handleJoinDevice(client: VatioSocket, deviceId: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { ownerId: true, enabled: true },
    });
    const user = client.data.user;
    if (!user) throw new WsException('Unauthorized');
    if (!device || (user.role !== 'admin' && device.ownerId !== user.userId)) {
      throw new WsException('Device not found or unauthorized');
    }
    // Suspended / unpaid accounts and switched-off devices get no live data.
    try {
      await this.access.assertDataAccess(user.userId, user.role);
      this.access.assertDeviceEnabled(device, user.role);
    } catch (err) {
      throw new WsException((err as Error).message);
    }
    await client.join(`device_${deviceId}`);
    this.logger.log(`Client ${client.id} joined room: device_${deviceId}`);
  }

  // Called by the Aggregation Engine on every 5-second cycle
  sendUpdate(deviceId: string, data: TelemetryUpdate) {
    // Emit only to the device-specific room (clients who joined via 'joinDevice')
    this.server.to(`device_${deviceId}`).emit('telemetry_update', data);
  }
}
