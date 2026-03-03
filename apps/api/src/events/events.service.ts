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
    this.gateway.server.to('admin').emit(event, payload);

    // Notify CS
    this.gateway.server.to('cs-all').emit(event, payload);
    if (data.assignedCsId) {
      this.gateway.server.to(`cs-${data.assignedCsId}`).emit(event, payload);
    }

    // Notify logistics
    this.gateway.server.to('logistics').emit(event, payload);
    if (data.logisticsLocationId) {
      this.gateway.server.to(`3pl-${data.logisticsLocationId}`).emit(event, payload);
    }

    // Notify rider
    if (data.riderId) {
      this.gateway.server.to(`rider-${data.riderId}`).emit(event, payload);
    }

    // Notify marketing
    this.gateway.server.to('marketing-all').emit(event, payload);
    if (data.mediaBuyerId) {
      this.gateway.server.to(`marketing-${data.mediaBuyerId}`).emit(event, payload);
    }
  }

  /**
   * New order created — notify CS dispatch and admin.
   */
  emitNewOrder(data: { orderId: string; productName: string }) {
    const event = 'order:new';
    const payload = { ...data, timestamp: new Date().toISOString() };
    this.gateway.server.to('admin').emit(event, payload);
    this.gateway.server.to('cs-all').emit(event, payload);
  }

  /**
   * Financial approval required — notify finance dashboard.
   */
  emitFinanceApproval(data: { type: string; referenceId: string; amount: string; requestedBy: string }) {
    const event = 'finance:approval_required';
    const payload = { ...data, timestamp: new Date().toISOString() };
    this.gateway.server.to('finance').emit(event, payload);
    this.gateway.server.to('admin').emit(event, payload);
  }

  /**
   * Stock alert — notify logistics and admin.
   */
  emitStockAlert(data: { productId: string; locationId: string; alertType: string; message: string }) {
    const event = 'stock:alert';
    const payload = { ...data, timestamp: new Date().toISOString() };
    this.gateway.server.to('logistics').emit(event, payload);
    this.gateway.server.to('admin').emit(event, payload);
    this.gateway.server.to(`3pl-${data.locationId}`).emit(event, payload);
  }

  /**
   * Generic notification to a specific user.
   */
  emitToUser(userId: string, event: string, data: Record<string, unknown>) {
    this.gateway.server.to(`user-${userId}`).emit(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Generic notification to a named room.
   */
  emitToRoom(room: string, event: string, data: Record<string, unknown>) {
    this.gateway.server.to(room).emit(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }
}
