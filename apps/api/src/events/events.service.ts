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

  private resolveRoom(room: string, branchId?: string | null): string {
    if (!branchId) return room;
    if (!['admin', 'finance', 'cs-all', 'logistics', 'marketing-all', 'hr'].includes(room)) {
      return room;
    }
    return `branch-${branchId}:${room}`;
  }

  private safeEmit(room: string, event: string, payload: Record<string, unknown>, branchId?: string | null) {
    try {
      const resolved = this.resolveRoom(room, branchId);
      this.gateway.server.to(resolved).emit(event, payload);
      // Also emit to the unscoped room so admin-class users (who join the
      // base room without branch prefix) receive branch-scoped events.
      if (resolved !== room) {
        this.gateway.server.to(room).emit(event, payload);
      }
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
    /** Marketing branch — scopes the `marketing-all` / `admin` rooms. */
    branchId?: string | null;
    /**
     * CS servicing branch — scopes the `cs-all` / `logistics` rooms. Migration
     * 0150 split this from `branchId`; falls back to `branchId` when omitted.
     */
    servicingBranchId?: string | null;
  }) {
    const event = 'order:status_changed';
    const payload = { ...data, timestamp: new Date().toISOString() };
    const csBranch = data.servicingBranchId ?? data.branchId;

    // Notify admin dashboard
    this.safeEmit('admin', event, payload, data.branchId);

    // Notify CS — scoped to the servicing branch that works the order
    this.safeEmit('cs-all', event, payload, csBranch);
    if (data.assignedCsId) {
      this.safeEmit(`cs-${data.assignedCsId}`, event, payload);
    }

    // Notify logistics — fulfillment happens in the servicing branch
    this.safeEmit('logistics', event, payload, csBranch);
    if (data.logisticsLocationId) {
      this.safeEmit(`3pl-${data.logisticsLocationId}`, event, payload);
    }

    // Notify rider
    if (data.riderId) {
      this.safeEmit(`rider-${data.riderId}`, event, payload);
    }

    // Notify marketing
    this.safeEmit('marketing-all', event, payload, data.branchId);
    if (data.mediaBuyerId) {
      this.safeEmit(`marketing-${data.mediaBuyerId}`, event, payload);
    }
  }

  /**
   * New order created — notify CS dispatch, admin, and marketing.
   * Media buyers only join `marketing-${userId}` (not marketing-all), so fan-out to that room too.
   */
  emitNewOrder(data: {
    orderId: string;
    productName: string;
    /** Marketing branch — scopes the `marketing-all` / `admin` rooms. */
    branchId?: string | null;
    /**
     * CS servicing branch — scopes the `cs-all` room so the CS team that
     * actually works the order gets the dispatch ping. Migration 0150; falls
     * back to `branchId` when omitted.
     */
    servicingBranchId?: string | null;
    mediaBuyerId?: string | null;
  }) {
    const event = 'order:new';
    const payload = { ...data, timestamp: new Date().toISOString() };
    this.safeEmit('admin', event, payload, data.branchId);
    this.safeEmit('cs-all', event, payload, data.servicingBranchId ?? data.branchId);
    this.safeEmit('marketing-all', event, payload, data.branchId);
    if (data.mediaBuyerId) {
      this.safeEmit(`marketing-${data.mediaBuyerId}`, event, payload);
    }
  }

  /**
   * Financial approval required — notify finance dashboard.
   */
  emitFinanceApproval(data: { type: string; referenceId: string; amount: string; requestedBy: string; branchId?: string | null }) {
    const event = 'finance:approval_required';
    const payload = { ...data, timestamp: new Date().toISOString() };
    this.safeEmit('finance', event, payload, data.branchId);
    this.safeEmit('admin', event, payload, data.branchId);
  }

  /**
   * Stock alert — notify logistics and admin.
   */
  emitStockAlert(data: { productId: string; locationId: string; alertType: string; message: string; branchId?: string | null }) {
    const event = 'stock:alert';
    const payload = { ...data, timestamp: new Date().toISOString() };
    this.safeEmit('logistics', event, payload, data.branchId);
    this.safeEmit('admin', event, payload, data.branchId);
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
  emitToRoom(room: string, event: string, data: Record<string, unknown>, branchId?: string | null) {
    this.safeEmit(room, event, {
      ...data,
      timestamp: new Date().toISOString(),
    }, branchId);
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

  // ── Follow-Up Sync Progress ──────────────────────────────────────

  emitFollowUpSyncProgress(data: {
    syncId: string;
    triggeredBy: 'cron' | 'manual';
    startedAt: string;
    totalRules: number;
    currentRuleIndex: number;
    currentRuleName: string;
    currentRulePulled: number;
    totalPulledSoFar: number;
    ruleResults: Array<{ ruleName: string; pulled: number }>;
    status: 'running' | 'complete' | 'error';
    errorMessage?: string;
  }) {
    this.safeEmit('admin', 'followup:sync_progress', data);
  }
}
