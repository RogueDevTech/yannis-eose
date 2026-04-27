/**
 * Subtle color signals for KPI rates rendered on team / leaderboard pages.
 *
 * Threshold rationale (Nigerian COD ecom — flagged 2026-04-27):
 * - Confirmation rate: of (confirmed + cancelled) orders, how many the customer
 *   confirmed on the call. Industry decent ≥ 75%, action needed < 50%.
 * - Delivery rate: of confirmed orders, how many actually delivered. Lower
 *   ceiling because returns/no-shows are common — decent ≥ 60%, action < 40%.
 *
 * Color tokens deliberately avoid green — green is reserved for system success
 * states (saved, completed). Healthy KPIs render in the default app foreground.
 */

function colorForRate(rate: number | null | undefined, redBelow: number, amberBelow: number): string {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return 'text-app-fg-muted';
  if (rate < redBelow) return 'text-danger-600 dark:text-danger-400';
  if (rate < amberBelow) return 'text-warning-600 dark:text-warning-400';
  return 'text-app-fg';
}

export function confirmationRateColorClass(rate: number | null | undefined): string {
  return colorForRate(rate, 50, 75);
}

export function deliveryRateColorClass(rate: number | null | undefined): string {
  return colorForRate(rate, 40, 60);
}

/** Format a 0–100 percentage for display. Empty / non-finite / non-positive → "0%". */
export function formatRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return '0%';
  return `${rate.toFixed(1)}%`;
}
