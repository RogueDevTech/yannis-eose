import type { OrderStatus } from '@yannis/shared';

/**
 * Order State Machine — enforces valid transitions and gates.
 *
 * Hard rules:
 * - Orders CANNOT skip states
 * - Every transition requires an authenticated actor
 * - Every transition is permanently logged via temporal audit trail
 */

interface TransitionRule {
  from: OrderStatus;
  to: OrderStatus;
  gate?: string; // description of what must pass
}

/**
 * The complete set of allowed transitions.
 * Any transition not in this list is REJECTED.
 */
const ALLOWED_TRANSITIONS: TransitionRule[] = [
  // CS assignment (set by auto-dispatch or assignToCS; not a user-triggered transition from UI)
  { from: 'UNPROCESSED', to: 'CS_ASSIGNED' },
  // CS engagement flow
  { from: 'UNPROCESSED', to: 'CS_ENGAGED', gate: 'Agent must have capacity' },
  { from: 'CS_ASSIGNED', to: 'CS_ENGAGED', gate: 'Agent must have capacity' },
  { from: 'CS_ASSIGNED', to: 'CANCELLED', gate: 'Mandatory reason note (min 10 chars)' },
  { from: 'CS_ENGAGED', to: 'CONFIRMED', gate: 'VOIP call_duration > 15 seconds' },
  { from: 'CS_ENGAGED', to: 'CANCELLED', gate: 'Mandatory reason note (min 10 chars)' },
  { from: 'UNPROCESSED', to: 'CANCELLED', gate: 'Mandatory reason note (min 10 chars)' },

  // Logistics flow
  { from: 'CONFIRMED', to: 'ALLOCATED', gate: '3PL location must have available stock' },
  { from: 'ALLOCATED', to: 'DISPATCHED', gate: 'Rider must be assigned' },
  { from: 'DISPATCHED', to: 'IN_TRANSIT', gate: 'Rider confirms departure' },

  // Delivery outcomes
  { from: 'IN_TRANSIT', to: 'DELIVERED', gate: 'OTP match required (SuperAdmin override allowed)' },
  { from: 'IN_TRANSIT', to: 'PARTIALLY_DELIVERED', gate: 'Must specify delivered qty vs returned qty' },
  { from: 'IN_TRANSIT', to: 'RETURNED', gate: 'Mandatory return reason' },

  // Post-delivery
  { from: 'DELIVERED', to: 'COMPLETED' },
  { from: 'RETURNED', to: 'RESTOCKED', gate: 'Quality check by 3PL manager' },
  { from: 'RETURNED', to: 'WRITTEN_OFF', gate: 'Mandatory damage note' },

  // Partial delivery flows
  { from: 'PARTIALLY_DELIVERED', to: 'COMPLETED' },
];

/**
 * Check if a transition is allowed.
 */
export function isTransitionAllowed(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

/**
 * Get all allowed next statuses for a given status.
 */
export function getAllowedNextStatuses(from: OrderStatus): OrderStatus[] {
  return ALLOWED_TRANSITIONS
    .filter((t) => t.from === from)
    .map((t) => t.to);
}

/**
 * Get the transition rule (with gate info) for a specific from → to.
 */
export function getTransitionRule(from: OrderStatus, to: OrderStatus): TransitionRule | undefined {
  return ALLOWED_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

/**
 * Statuses that represent terminal states (no further transitions).
 */
export const TERMINAL_STATUSES: OrderStatus[] = ['COMPLETED', 'WRITTEN_OFF', 'RESTOCKED'];

/**
 * Statuses where stock reservation should be triggered.
 */
export const STOCK_RESERVATION_STATUS: OrderStatus = 'CONFIRMED';

/**
 * Statuses where stock deduction (delivery) should be triggered.
 */
export const STOCK_DEDUCTION_STATUS: OrderStatus = 'DELIVERED';

/**
 * Timestamp fields to set on specific transitions.
 */
export const TRANSITION_TIMESTAMPS: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: 'confirmedAt',
  ALLOCATED: 'allocatedAt',
  DISPATCHED: 'dispatchedAt',
  DELIVERED: 'deliveredAt',
};
