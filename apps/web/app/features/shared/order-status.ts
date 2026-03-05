export const STATUS_COLORS: Record<string, string> = {
  UNPROCESSED: 'badge-warning',
  CS_ASSIGNED: 'badge-info',
  CS_ENGAGED: 'badge-info',
  CONFIRMED: 'badge-brand',
  CANCELLED: 'badge-danger',
  ALLOCATED: 'badge-info',
  DISPATCHED: 'badge-info',
  IN_TRANSIT: 'badge-brand',
  DELIVERED: 'badge-success',
  PARTIALLY_DELIVERED: 'badge-warning',
  RETURNED: 'badge-danger',
  RESTOCKED: 'badge-info',
  WRITTEN_OFF: 'badge-danger',
  COMPLETED: 'badge-success',
};

/** Dot color class for status card (status-dot + this class). */
export const STATUS_DOT_CLASS: Record<string, string> = {
  UNPROCESSED: 'bg-warning-500',
  CS_ASSIGNED: 'bg-info-500',
  CS_ENGAGED: 'bg-info-500',
  CONFIRMED: 'bg-brand-500',
  CANCELLED: 'bg-danger-500',
  ALLOCATED: 'bg-info-500',
  DISPATCHED: 'bg-info-500',
  IN_TRANSIT: 'bg-brand-500',
  DELIVERED: 'bg-success-500',
  PARTIALLY_DELIVERED: 'bg-warning-500',
  RETURNED: 'bg-danger-500',
  RESTOCKED: 'bg-info-500',
  WRITTEN_OFF: 'bg-danger-500',
  COMPLETED: 'bg-success-500',
};

export const STATUS_OPTIONS = [
  'ALL',
  'UNPROCESSED',
  'CS_ASSIGNED',
  'CS_ENGAGED',
  'CONFIRMED',
  'CANCELLED',
  'ALLOCATED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
  'RETURNED',
  'COMPLETED',
];

export function formatStatus(status: string): string {
  return status.replace(/_/g, ' ');
}
