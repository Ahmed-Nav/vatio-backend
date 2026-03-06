import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';

@Injectable()
export class WsJwtGuard implements CanActivate {
    constructor(private jwtService: JwtService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        try {
            const client = context.switchToWs().getClient();
            const authToken = client.handshake?.auth?.token || client.handshake?.headers?.authorization?.split(' ')[1];

            const payload = await this.jwtService.verifyAsync(authToken);
            context.switchToWs().getClient().user = payload; // Attach user to socket
            return true;
        } catch (err) {
            throw new WsException('Unauthorized');
        }
    }
}