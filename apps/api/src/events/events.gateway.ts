import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import type Redis from 'ioredis';
import { REDIS } from '../database/database.module';
import type { SessionUser } from '../common/decorators/current-user.decorator';

/**
 * WebSocket gateway with authenticated connections.
 * Users join role-appropriate "rooms" on connection.
 *
 * Room naming:
 * - admin           → SuperAdmin dashboard
 * - finance         → Finance dashboard
 * - cs-{userId}     → Individual CS agent
 * - cs-all          → Head of CS (all CS events)
 * - logistics       → Head of Logistics
 * - marketing-{userId} → Individual Media Buyer
 * - marketing-all   → Head of Marketing
 * - 3pl-{locationId}  → 3PL location-specific events
 * - hr              → HR dashboard
 */
@WebSocketGateway({
  cors: {
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async handleConnection(client: Socket) {
    try {
      const user = await this.authenticateSocket(client);
      if (!user) {
        client.disconnect();
        return;
      }

      // Store user data on the socket
      client.data.user = user;

      // Join role-appropriate rooms
      this.joinRooms(client, user);

      client.emit('connected', { userId: user.id, role: user.role });
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const user = client.data.user as SessionUser | undefined;
    if (user) {
      // Cleanup is automatic — Socket.io removes from rooms on disconnect
    }
  }

  /**
   * Authenticate the WebSocket connection using the session cookie.
   */
  private async authenticateSocket(client: Socket): Promise<SessionUser | null> {
    const cookies = client.handshake.headers.cookie;
    if (!cookies) return null;

    const match = cookies.split(';').find((c) => c.trim().startsWith('yannis_session='));
    if (!match) return null;

    const token = match.split('=')[1]?.trim();
    if (!token) return null;

    const sessionData = await this.redis.get(`session:${token}`);
    if (!sessionData) return null;

    return JSON.parse(sessionData) as SessionUser;
  }

  /**
   * Assign the connected user to the appropriate rooms based on their role.
   */
  private joinRooms(client: Socket, user: SessionUser): void {
    // Everyone joins their personal room
    void client.join(`user-${user.id}`);

    switch (user.role) {
      case 'SUPER_ADMIN':
        void client.join('admin');
        void client.join('finance');
        void client.join('cs-all');
        void client.join('logistics');
        void client.join('marketing-all');
        void client.join('hr');
        break;
      case 'HEAD_OF_CS':
        void client.join('cs-all');
        break;
      case 'CS_AGENT':
        void client.join(`cs-${user.id}`);
        break;
      case 'FINANCE_OFFICER':
        void client.join('finance');
        break;
      case 'HEAD_OF_LOGISTICS':
        void client.join('logistics');
        break;
      case 'WAREHOUSE_MANAGER':
        void client.join('logistics');
        break;
      case 'HEAD_OF_MARKETING':
        void client.join('marketing-all');
        break;
      case 'MEDIA_BUYER':
        void client.join(`marketing-${user.id}`);
        break;
      case 'TPL_MANAGER':
        if (user.logisticsLocationId) {
          void client.join(`3pl-${user.logisticsLocationId}`);
        }
        break;
      case 'TPL_RIDER':
        void client.join(`rider-${user.id}`);
        if (user.logisticsLocationId) {
          void client.join(`3pl-${user.logisticsLocationId}`);
        }
        break;
      case 'HR_MANAGER':
        void client.join('hr');
        break;
    }
  }
}
