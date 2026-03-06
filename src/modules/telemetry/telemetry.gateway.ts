import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
    cors: { origin: '*' },
    namespace: 'telemetry',
})
export class TelemetryGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;
    private readonly logger = new Logger(TelemetryGateway.name);

    constructor(private readonly jwtService: JwtService) { }

    async handleConnection(client: Socket) {
        try {
            const token = client.handshake?.auth?.token ||
                client.handshake?.headers?.authorization?.split(' ')[1];

            if (!token) {
                throw new Error('No token provided');
            }
            await this.jwtService.verifyAsync(token);
            this.logger.log(`Authenticated client connected: ${client.id}`);
        } catch (err) {
            this.logger.warn(`Unauthenticated connection rejected: ${client.id}`);
            client.disconnect(true);
        }
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    // Allow users to join a specific device's data room
    @UseGuards(WsJwtGuard)
    @SubscribeMessage('joinDevice')
    handleJoinDevice(client: Socket, deviceId: string) {
        client.join(`device_${deviceId}`);
        this.logger.log(`Client ${client.id} joined room: device_${deviceId}`);
    }

    // This helper will be called by your Aggregator
    sendUpdate(deviceId: string, data: any) {
        this.server.to(`device_${deviceId}`).emit('telemetryUpdate', data);
    }
}