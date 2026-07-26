import type { FinancialKPIs } from './types';

interface KPIConfig {
  key: keyof FinancialKPIs;
  label: string;
  unit: '%' | 'x' | 'days' | 'ratio';
  /** Format the raw number for display. */
  format: (v: number | null) => string;
  /** [green-min, green-max, amber-min, amber-max] — outside amber = red. */
  thresholds: { green: [number, number]; amber: [number, number] };
  /** Description shown on hover/tap. */
  description: string;
}

/** Coerce API / JSON values; null stays null (used for infinite interest coverage). */
function asFiniteNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const pct = (v: number | null) => (v == null ? '--' : `${v.toFixed(1)}%`);
const ratio = (v: number | null) => (v == null ? '--' : v.toFixed(2));
const days = (v: number | null) => (v == null ? '--' : `${v.toFixed(0)}d`);
const times = (v: number | null) => (v == null ? '--' : `${v.toFixed(1)}x`);

const KPI_CONFIGS: KPIConfig[] = [
  // ── Liquidity ──
  {
    key: 'currentRatio',
    label: 'Current Ratio',
    unit: 'x',
    format: times,
    thresholds: { green: [1.5, 3], amber: [1, 1.5] },
    description: 'Current Assets / Current Liabilities. Measures short-term solvency.',
  },
  {
    key: 'quickRatio',
    label: 'Quick Ratio',
    unit: 'x',
    format: times,
    thresholds: { green: [1, 3], amber: [0.5, 1] },
    description: '(Current Assets - Inventory) / Current Liabilities. Liquid coverage without stock.',
  },
  {
    key: 'cashRatio',
    label: 'Cash Ratio',
    unit: 'x',
    format: times,
    thresholds: { green: [0.5, 2], amber: [0.2, 0.5] },
    description: 'Cash & Bank / Current Liabilities. Strictest liquidity measure.',
  },

  // ── Profitability ──
  {
    key: 'grossProfitMargin',
    label: 'Gross Profit Margin',
    unit: '%',
    format: pct,
    thresholds: { green: [40, 100], amber: [20, 40] },
    description: 'Gross Profit / Revenue. How much of each Naira is left after COGS.',
  },
  {
    key: 'operatingProfitMargin',
    label: 'Operating Margin',
    unit: '%',
    format: pct,
    thresholds: { green: [15, 100], amber: [5, 15] },
    description: 'EBIT / Revenue. Profit from core operations before interest.',
  },
  {
    key: 'netProfitMargin',
    label: 'Net Profit Margin',
    unit: '%',
    format: pct,
    thresholds: { green: [10, 100], amber: [2, 10] },
    description: 'Net Profit / Revenue. Bottom-line profitability.',
  },

  // ── Returns ──
  {
    key: 'returnOnAssets',
    label: 'Return on Assets',
    unit: '%',
    format: pct,
    thresholds: { green: [5, 100], amber: [1, 5] },
    description: 'Net Profit / Total Assets. Efficiency of asset utilization.',
  },
  {
    key: 'returnOnEquity',
    label: 'Return on Equity',
    unit: '%',
    format: pct,
    thresholds: { green: [15, 100], amber: [5, 15] },
    description: 'Net Profit / Total Equity. Return generated for owners.',
  },

  // ── Leverage ──
  {
    key: 'debtToEquity',
    label: 'Debt to Equity',
    unit: 'ratio',
    format: ratio,
    thresholds: { green: [0, 1], amber: [1, 2] },
    description: 'Total Liabilities / Total Equity. Financial leverage level.',
  },

  // ── Efficiency ──
  {
    key: 'daysSalesOutstanding',
    label: 'Days Sales Outstanding',
    unit: 'days',
    format: days,
    thresholds: { green: [0, 30], amber: [30, 60] },
    description: '(Accounts Receivable / Revenue) x 365. Average collection period.',
  },
  {
    key: 'inventoryTurnover',
    label: 'Inventory Turnover',
    unit: 'x',
    format: times,
    thresholds: { green: [4, 50], amber: [2, 4] },
    description: 'COGS / Avg Inventory. How many times stock turns per year.',
  },
  {
    key: 'daysInventoryOutstanding',
    label: 'Days Inventory Outstanding',
    unit: 'days',
    format: days,
    thresholds: { green: [0, 60], amber: [60, 120] },
    description: '(Avg Inventory / COGS) x 365. Average days stock is held.',
  },

  // ── Coverage ──
  {
    key: 'interestCoverage',
    label: 'Interest Coverage',
    unit: 'x',
    format: (v) => (v == null ? 'No debt' : times(v)),
    thresholds: { green: [3, Number.POSITIVE_INFINITY], amber: [1.5, 3] },
    description: 'EBIT / Interest Expense. Ability to service debt.',
  },

  // ── Cycle ──
  {
    key: 'cashConversionCycle',
    label: 'Cash Conversion Cycle',
    unit: 'days',
    format: days,
    thresholds: { green: [Number.NEGATIVE_INFINITY, 30], amber: [30, 60] },
    description: 'DIO + DSO - AP Days. Time between paying for stock and collecting cash.',
  },
];

function getHealthColor(value: number | null, config: KPIConfig): 'green' | 'amber' | 'red' {
  // null interest coverage = no interest expense = healthy
  if (value == null) {
    if (config.key === 'interestCoverage') return 'green';
    return 'red';
  }

  const { green, amber } = config.thresholds;

  // For most KPIs: value in green range = green, in amber range = amber, else red.
  // Special handling for inverted KPIs (lower is better): DSO, DIO, debtToEquity, CCC.
  if (value >= green[0] && value <= green[1]) return 'green';
  if (value >= amber[0] && value <= amber[1]) return 'amber';
  return 'red';
}

const COLOR_CLASSES: Record<'green' | 'amber' | 'red', { dot: string; bg: string }> = {
  green: { dot: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  amber: { dot: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30' },
  red: { dot: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950/30' },
};

const SECTION_LABELS: Array<{ label: string; start: number; count: number }> = [
  { label: 'Liquidity', start: 0, count: 3 },
  { label: 'Profitability', start: 3, count: 3 },
  { label: 'Returns', start: 6, count: 2 },
  { label: 'Leverage', start: 8, count: 1 },
  { label: 'Efficiency', start: 9, count: 3 },
  { label: 'Coverage', start: 12, count: 1 },
  { label: 'Cycle', start: 13, count: 1 },
];

export function FinanceKPIDashboard({ kpis }: { kpis: FinancialKPIs }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-app-fg-muted uppercase tracking-wide">
        Financial Health KPIs
      </h3>

      {SECTION_LABELS.map((section) => (
        <div key={section.label}>
          <p className="text-xs font-medium text-app-fg-muted mb-2">{section.label}</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
            {KPI_CONFIGS.slice(section.start, section.start + section.count).map((config) => {
              const value = asFiniteNumber(kpis[config.key]);
              const health = getHealthColor(value, config);
              const colors = COLOR_CLASSES[health];
              return (
                <div
                  key={config.key}
                  className={`rounded-lg border border-app-border p-3 ${colors.bg}`}
                  title={config.description}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`inline-block h-2 w-2 rounded-full ${colors.dot}`} />
                    <span className="text-xs font-medium text-app-fg-muted truncate">
                      {config.label}
                    </span>
                  </div>
                  <p className="text-lg font-semibold text-app-fg tabular-nums">
                    {config.format(value)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
