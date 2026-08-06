import type { AutomationService } from './automation.service';
import type { MarketingAutomationEvent } from '@yannis/shared';

/**
 * Decoupled bridge between lifecycle code (orders, cart) and the automation
 * engine. Services call these fire-and-forget helpers WITHOUT importing the
 * automation module, so there is no orders↔automation dependency cycle. The
 * concrete `AutomationService` is registered once at boot
 * (`setAutomationHookService`, called from TrpcModule.onModuleInit alongside
 * `setAutomationService`). Before registration the helpers are no-ops.
 */
let hookService: AutomationService | null = null;

export function setAutomationHookService(service: AutomationService): void {
  hookService = service;
}

/**
 * Fire order-lifecycle automation events for a status transition. Maps the new
 * status to the specific events rules can subscribe to, always including the
 * generic `order:status_changed`. Never throws.
 */
export function emitOrderAutomationEvents(args: {
  orderId: string;
  newStatus: string;
  customerPhoneHash?: string | null;
  branchId?: string | null;
  groupId?: string | null;
}): void {
  const svc = hookService;
  if (!svc) return;

  const events: MarketingAutomationEvent[] = ['order:status_changed'];
  if (args.newStatus === 'CONFIRMED') events.push('order:confirmed');
  if (args.newStatus === 'DELIVERED') events.push('order:delivered');

  for (const event of events) {
    svc.onEvent({
      event,
      orderId: args.orderId,
      newStatus: args.newStatus,
      customerPhoneHash: args.customerPhoneHash ?? null,
      branchId: args.branchId ?? null,
      groupId: args.groupId ?? null,
    });
  }
}

/** Fire the cart:abandoned event for a newly-abandoned cart. Never throws. */
export function emitCartAbandonedAutomationEvent(args: {
  cartId: string;
  customerPhoneHash?: string | null;
  branchId?: string | null;
  groupId?: string | null;
}): void {
  const svc = hookService;
  if (!svc) return;
  svc.onEvent({
    event: 'cart:abandoned',
    cartId: args.cartId,
    customerPhoneHash: args.customerPhoneHash ?? null,
    branchId: args.branchId ?? null,
    groupId: args.groupId ?? null,
  });
}
