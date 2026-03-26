import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { SessionStoreService } from '../auth/session-store.service';
import { RedisHealthService } from '../database/redis-health.service';

interface AgentStatePayload {
  agentId: string;
  currentRoute: string;
  currentOrderId?: string | null;
  currentPanel?: string | null;
  lastActionAt: string;
}

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
/**
 * CORS origins for API and WebSocket (comma-separated in env).
 */
function getCorsOrigins(): string | string[] {
  const corsOrigin = process.env['CORS_ORIGIN'] ?? 'http://localhost:5173';
  const list = corsOrigin.split(',').map((o) => o.trim()).filter(Boolean);
  return list.length > 1 ? list : list[0] || 'http://localhost:5173';
}

@WebSocketGateway({
  cors: {
    origin: getCorsOrigins(),
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly sessionStore: SessionStoreService,
    private readonly redisHealth: RedisHealthService,
  ) {}

  afterInit(): void {
    this.redisHealth.onStateChange((state) => {
      this.logger.warn(`realtime_mode_changed redis_state=${state}`);
      this.server.emit('realtime:mode_changed', {
        mode: state === 'healthy' ? 'clustered' : 'degraded',
        redisState: state,
        timestamp: new Date().toISOString(),
      });
    });
  }

  async handleConnection(client: Socket) {
    // #region agent log
    const origin = String(client.handshake.headers.origin ?? '');
    const rawCookie = client.handshake.headers.cookie ?? '';
    const hasCookieHeader = rawCookie.length > 0;
    const hasYannisSessionName = rawCookie.includes('yannis_session=');
    // #endregion
    try {
      const user = await this.authenticateSocket(client);
      if (!user) {
        // #region agent log
        this.logger.warn(
          `[DEBUG-bc49f3] ws_handshake auth_fail origin=${origin} hasCookieHeader=${hasCookieHeader} hasYannisSessionName=${hasYannisSessionName}`,
        );
        // #endregion
        client.disconnect();
        return;
      }

      // Store user data on the socket
      client.data.user = user;

      // Join role-appropriate rooms
      this.joinRooms(client, user);

      client.emit('connected', { userId: user.id, role: user.role });
      // #region agent log
      this.logger.warn(`[DEBUG-bc49f3] ws_handshake auth_ok role=${user.role} origin=${origin}`);
      // #endregion
    } catch {
      // #region agent log
      this.logger.warn(
        `[DEBUG-bc49f3] ws_handshake exception origin=${origin} hasCookieHeader=${hasCookieHeader}`,
      );
      // #endregion
      client.disconnect();
    }
  }

  /**
   * CS agent broadcasts their current UI state.
   * Server broadcasts to cs-all for Team Live View.
   */
  @SubscribeMessage('agent:state_update')
  async handleAgentStateUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: Omit<AgentStatePayload, 'agentId'>,
  ) {
    const user = client.data.user as SessionUser | undefined;
    if (!user || user.role !== 'CS_AGENT') return;

    const state: AgentStatePayload = {
      agentId: user.id,
      currentRoute: payload.currentRoute,
      currentOrderId: payload.currentOrderId ?? null,
      currentPanel: payload.currentPanel ?? null,
      lastActionAt: new Date().toISOString(),
    };

    // Broadcast to cs-all room (Team Live View panel)
    this.server.to('cs-all').emit('agent:state_update', state);
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

    return this.sessionStore.getSession(token);
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
