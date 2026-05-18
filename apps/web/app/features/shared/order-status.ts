/**
 * Single source of truth for order status display: badge, dot, text, and hex.
 * Every status has a unique color — no two statuses share the same theme.
 */

const ORDER_STATUS_THEMES: Record<
  string,
  { badge: string; dot: string; text: string; hex: string }
> = {
  UNPROCESSED: {
    badge:
      'badge bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    hex: '#f59e0b',
  },
  CS_ASSIGNED: {
    badge: 'badge bg-sky-50 text-sky-800 dark:bg-sky-900/20 dark:text-sky-300',
    dot: 'bg-sky-500',
    text: 'text-sky-600 dark:text-sky-400',
    hex: '#0ea5e9',
  },
  CS_ENGAGED: {
    badge: 'badge bg-cyan-50 text-cyan-800 dark:bg-cyan-900/20 dark:text-cyan-300',
    dot: 'bg-cyan-500',
    text: 'text-cyan-600 dark:text-cyan-400',
    hex: '#06b6d4',
  },
  CONFIRMED: {
    badge:
      'badge bg-indigo-50 text-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300',
    dot: 'bg-indigo-500',
    text: 'text-indigo-600 dark:text-indigo-400',
    hex: '#6366f1',
  },
  CANCELLED: {
    badge: 'badge bg-rose-50 text-rose-800 dark:bg-rose-900/20 dark:text-rose-300',
    dot: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
    hex: '#f43f5e',
  },
  AGENT_ASSIGNED: {
    badge: 'badge bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300',
    dot: 'bg-blue-500',
    text: 'text-blue-600 dark:text-blue-400',
    hex: '#3b82f6',
  },
  DISPATCHED: {
    badge:
      'badge bg-violet-50 text-violet-800 dark:bg-violet-900/20 dark:text-violet-300',
    dot: 'bg-violet-500',
    text: 'text-violet-600 dark:text-violet-400',
    hex: '#8b5cf6',
  },
  IN_TRANSIT: {
    badge:
      'badge bg-purple-50 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300',
    dot: 'bg-purple-500',
    text: 'text-purple-600 dark:text-purple-400',
    hex: '#a855f7',
  },
  DELIVERED: {
    badge:
      'badge bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    hex: '#10b981',
  },
  PARTIALLY_DELIVERED: {
    badge:
      'badge bg-yellow-50 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300',
    dot: 'bg-yellow-500',
    text: 'text-yellow-600 dark:text-yellow-400',
    hex: '#eab308',
  },
  RETURNED: {
    badge: 'badge bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300',
    dot: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
    hex: '#ef4444',
  },
  RESTOCKED: {
    badge: 'badge bg-teal-50 text-teal-800 dark:bg-teal-900/20 dark:text-teal-300',
    dot: 'bg-teal-500',
    text: 'text-teal-600 dark:text-teal-400',
    hex: '#14b8a6',
  },
  WRITTEN_OFF: {
    badge: 'badge bg-zinc-100 text-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300',
    dot: 'bg-zinc-500',
    text: 'text-zinc-600 dark:text-zinc-400',
    hex: '#71717a',
  },
  REMITTED: {
    badge:
      'badge bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300',
    dot: 'bg-green-500',
    text: 'text-green-600 dark:text-green-400',
    hex: '#22c55e',
  },
};

/** Badge class string (bg + text, light + dark) for order status badges. */
export const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(ORDER_STATUS_THEMES).map(([k, v]) => [k, v.badge])
);

/** Dot color class for status card (status-dot + this class). */
export const STATUS_DOT_CLASS: Record<string, string> = Object.fromEntries(
  Object.entries(ORDER_STATUS_THEMES).map(([k, v]) => [k, v.dot])
);

/** Text-only class for count cards / non-badge usage (e.g. CEO dashboard). */
export const STATUS_TEXT_CLASS: Record<string, string> = Object.fromEntries(
  Object.entries(ORDER_STATUS_THEMES).map(([k, v]) => [k, v.text])
);

/** Hex color for Recharts and other non-CSS usage. */
export const STATUS_HEX: Record<string, string> = Object.fromEntries(
  Object.entries(ORDER_STATUS_THEMES).map(([k, v]) => [k, v.hex])
);

/** Human-readable labels for order statuses. */
export const STATUS_LABELS: Record<string, string> = {
  UNPROCESSED: 'Unassigned',
  CS_ASSIGNED: 'Assigned',
  CS_ENGAGED: 'Unconfirmed',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  AGENT_ASSIGNED: 'Agent assigned',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In Transit',
  DELIVERED: 'Delivered',
  PARTIALLY_DELIVERED: 'Partial',
  RETURNED: 'Returned',
  RESTOCKED: 'Restocked',
  WRITTEN_OFF: 'Written Off',
  REMITTED: 'Cash Remitted',
};

/**
 * The six top-level order buckets the CEO wants visible across admin order
 * surfaces (CEO directive 2026-05-09). Logistics-flow sub-stages
 * (AGENT_ASSIGNED, DISPATCHED, IN_TRANSIT) and exception states (CANCELLED,
 * RETURNED, PARTIALLY_DELIVERED, RESTOCKED, WRITTEN_OFF) are still real enum
 * values — they're rendered in detail pages, timelines, audit log — but they
 * no longer appear in the top-level filter row or status dropdown.
 *
 * The Logistics module's own page (`/admin/logistics/orders`) and the TPL
 * portal define their own scoped option list and intentionally keep the
 * sub-stages — that's where ops actually drive the in-flight pipeline.
 */
export const STATUS_OPTIONS = [
  'ALL',
  'UNPROCESSED',
  'CS_ASSIGNED',
  'CS_ENGAGED',
  'CONFIRMED',
  'DELIVERED',
  'REMITTED',
];

export function formatStatus(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}
