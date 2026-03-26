import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import type Redis from 'ioredis';
import { REDIS } from '../database/database.module';
import type { SessionUser } from '../common/decorators/current-user.decorator';

/** Redis key prefix for last-known agent state (for initial mirror load). */
const AGENT_STATE_KEY = (agentId: string) => `agent_state:${agentId}`;
const AGENT_STATE_TTL = 3600; // 1 hour

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
    if (user?.role === 'CS_AGENT') {
      // Notify supervisors watching this agent that they disconnected
      this.server.to(`mirror:${user.id}`).emit('agent:disconnected', {
        agentId: user.id,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * CS agent broadcasts their current UI state.
   * Server re-emits to supervisor mirror room and stores in Redis for late-joiners.
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

    // Store last known state in Redis (for initial mirror load)
    await this.redis.setex(AGENT_STATE_KEY(user.id), AGENT_STATE_TTL, JSON.stringify(state));

    // Re-emit to all supervisors watching this agent's mirror room
    this.server.to(`mirror:${user.id}`).emit('agent:state_update', state);

    // Also broadcast to cs-all room (for Team Live View panel)
    this.server.to('cs-all').emit('agent:state_update', state);
  }

  /**
   * Supervisor requests to watch a CS agent's mirror.
   * Server joins the supervisor to the agent's mirror room and notifies the agent.
   */
  @SubscribeMessage('supervisor:watch_request')
  async handleWatchRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { agentId: string },
  ) {
    const user = client.data.user as SessionUser | undefined;
    if (!user || !['HEAD_OF_CS', 'SUPER_ADMIN'].includes(user.role)) return;

    const agentId = payload.agentId;
    const mirrorRoom = `mirror:${agentId}`;

    // Join supervisor to the mirror room
    await client.join(mirrorRoom);

    // Notify the agent they are being observed
    this.server.to(`cs-${agentId}`).emit('supervisor:watching', {
      supervisorId: user.id,
      supervisorName: user.name,
      timestamp: new Date().toISOString(),
    });

    // Send last known state to the joining supervisor (for immediate render)
    const lastState = await this.redis.get(AGENT_STATE_KEY(agentId));
    if (lastState) {
      client.emit('agent:state_update', JSON.parse(lastState));
    }
  }

  /**
   * Supervisor stops watching a CS agent.
   */
  @SubscribeMessage('supervisor:unwatch')
  async handleUnwatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { agentId: string },
  ) {
    const user = client.data.user as SessionUser | undefined;
    if (!user) return;

    await client.leave(`mirror:${payload.agentId}`);

    // Notify agent the supervisor stopped watching (only if no one else is watching)
    const room = this.server.sockets.adapter.rooms.get(`mirror:${payload.agentId}`);
    if (!room || room.size === 0) {
      this.server.to(`cs-${payload.agentId}`).emit('supervisor:stopped_watching', {
        timestamp: new Date().toISOString(),
      });
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
