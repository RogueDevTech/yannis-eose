export const STATUS_COLORS: Record<string, string> = {
  UNPROCESSED: 'badge-warning',
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

export const STATUS_OPTIONS = [
  'ALL',
  'UNPROCESSED',
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
