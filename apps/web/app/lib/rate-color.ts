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
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return 'text-danger-600 dark:text-danger-400';
  if (rate < redBelow) return 'text-danger-600 dark:text-danger-400';
  if (rate < amberBelow) return 'text-warning-600 dark:text-warning-400';
  return 'text-success-600 dark:text-success-400';
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

/**
 * Color signal for CPA (Cost Per Acquisition). Lower = better (inverted scale).
 * - ≤ 0 or null → muted (no data)
 * - < ₦3,000    → green (healthy)
 * - < ₦6,000    → amber (watch)
 * - ≥ ₦6,000    → red (action needed)
 */
export function cpaColorClass(cpa: number | null | undefined): string {
  if (cpa == null || !Number.isFinite(cpa) || cpa <= 0) return 'text-app-fg-muted';
  if (cpa < 3000) return 'text-success-600 dark:text-success-400';
  if (cpa < 6000) return 'text-warning-600 dark:text-warning-400';
  return 'text-danger-600 dark:text-danger-400';
}

/**
 * Color signal for delinquency rate (returned + partially delivered + written off
 * over total assigned to a logistics provider). Higher = worse, opposite of
 * confirmation/delivery rate.
 *
 * - > 10% → red (action needed)
 * - > 5%  → amber (watch)
 * - else  → default foreground (healthy)
 */
export function delinquencyRateColorClass(rate: number | null | undefined): string {
  if (rate == null) return 'text-app-fg';
  if (rate > 10) return 'text-danger-600 dark:text-danger-400 font-semibold';
  if (rate > 5) return 'text-warning-600 dark:text-warning-400';
  return 'text-app-fg';
}
