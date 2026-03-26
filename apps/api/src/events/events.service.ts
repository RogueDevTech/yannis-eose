import { Injectable } from '@nestjs/common';
import { EventsGateway } from './events.gateway';

/**
 * EventsService — centralized event emitter for real-time updates.
 *
 * Any NestJS service can inject this to push events to connected clients.
 * Events are emitted to specific rooms so users only receive
 * events relevant to their role.
 */
@Injectable()
export class EventsService {
  constructor(private readonly gateway: EventsGateway) {}

  private safeEmit(room: string, event: string, payload: Record<string, unknown>) {
    try {
      this.gateway.server.to(room).emit(event, payload);
    } catch {
      // Real-time delivery is best effort. Mutations must remain DB-authoritative.
    }
  }

  /**
   * Order status changed — notify relevant dashboards.
   */
  emitOrderStatusChange(data: {
    orderId: string;
    oldStatus: string;
    newStatus: string;
    assignedCsId?: string | null;
    mediaBuyerId?: string | null;
    logisticsLocationId?: string | null;
    riderId?: string | null;
  }) {
    const event = 'order:status_changed';
    const payload = { ...data, timestamp: new Date().toISOString() };

    // Notify admin dashboard
    this.safeEmit('admin', event, payload);

    // Notify CS
    this.safeEmit('cs-all', event, payload);
    if (data.assignedCsId) {
      this.safeEmit(`cs-${data.assignedCsId}`, event, payload);
    }

    // Notify logistics
    this.safeEmit('logistics', event, payload);
    if (data.logisticsLocationId) {
      this.safeEmit(`3pl-${data.logisticsLocationId}`, event, payload);
    }

    // Notify rider
    if (data.riderId) {
      this.safeEmit(`rider-${data.riderId}`, event, payload);
    }

    // Notify marketing
    this.safeEmit('marketing-all', event, payload);
    if (data.mediaBuyerId) {
      this.safeEmit(`marketing-${data.mediaBuyerId}`, event, payload);
    }
  }

  /**
   * New order created — notify CS dispatch, admin, and marketing.
   */
  emitNewOrder(data: { orderId: string; productName: string }) {
    const event = 'order:new';
    const payload = { ...data, timestamp: new Date().toISOString() };
    this.safeEmit('admin', event, payload);
    this.safeEmit('cs-all', event, payload);
    this.safeEmit('marketing-all', event, payload);
  }

  /**
   * Financial approval required — notify finance dashboard.
   */
  emitFinanceApproval(data: { type: string; referenceId: string; amount: string; requestedBy: string }) {
    const event = 'finance:approval_required';
    const payload = { ...data, timestamp: new Date().toISOString() };
    this.safeEmit('finance', event, payload);
    this.safeEmit('admin', event, payload);
  }

  /**
   * Stock alert — notify logistics and admin.
   */
  emitStockAlert(data: { productId: string; locationId: string; alertType: string; message: string }) {
    const event = 'stock:alert';
    const payload = { ...data, timestamp: new Date().toISOString() };
    this.safeEmit('logistics', event, payload);
    this.safeEmit('admin', event, payload);
    this.safeEmit(`3pl-${data.locationId}`, event, payload);
  }

  /**
   * Generic notification to a specific user.
   */
  emitToUser(userId: string, event: string, data: Record<string, unknown>) {
    this.safeEmit(`user-${userId}`, event, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Generic notification to a named room.
   */
  emitToRoom(room: string, event: string, data: Record<string, unknown>) {
    this.safeEmit(room, event, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit agent state update (from REST/tRPC path if needed, not socket path).
   * Socket path handled directly in EventsGateway.
   */
  emitAgentStateUpdate(data: {
    agentId: string;
    currentRoute: string;
    currentOrderId?: string | null;
    currentPanel?: string | null;
  }) {
    const payload = { ...data, lastActionAt: new Date().toISOString() };
    this.safeEmit('cs-all', 'agent:state_update', payload);
  }
}
