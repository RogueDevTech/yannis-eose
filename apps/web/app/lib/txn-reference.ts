/**
 * Short transaction reference for a UUID, e.g. TXN-0F3A9C21.
 *
 * Uses the random END of the id. Every table uses UUIDv7, whose first
 * characters are a timestamp: a prefix-based code repeats for every row created
 * within the same few hours, so two different transactions shared one reference.
 */
export function txnReference(id: string, prefix = 'TXN'): string {
  return `${prefix}-${id.replace(/-/g, '').slice(-8).toUpperCase()}`;
}
