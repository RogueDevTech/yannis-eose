import type { PayrollFormula } from '@yannis/shared';
import { formatNaira } from '~/lib/format-amount';

const METRIC_LABELS: Record<string, string> = {
  INDIVIDUAL_DR: 'individual delivery rate (DR %)',
  TEAM_DR: 'team delivery rate (DR %)',
  CPA: 'CPA (cost per acquisition)',
  DELIVERED_COUNT: 'delivered orders',
  QUALIFYING_REVENUE: 'qualifying revenue (delivered + remitted)',
  TARGET_MET: 'delivery target',
  NONE: 'no metric (flat)',
};

const OPERATOR_LABELS: Record<string, string> = {
  GTE: 'at least',
  GT: 'more than',
  LTE: 'at most',
  LT: 'less than',
  EQ: 'exactly',
};

function formatThreshold(metric: string, threshold: number): string {
  if (metric === 'TARGET_MET') return threshold >= 1 ? 'met' : 'not met';
  if (metric === 'CPA' || metric === 'QUALIFYING_REVENUE') return formatNaira(threshold);
  if (metric === 'DELIVERED_COUNT') return `${threshold}`;
  if (metric === 'NONE') return '';
  return `${threshold}%`;
}

function conditionPhrase(metric: string, operator: string, threshold: number): string {
  if (metric === 'NONE') return 'always';
  if (metric === 'TARGET_MET') {
    return threshold >= 1 ? 'when the delivery target is met' : 'when the delivery target is not met';
  }
  const metricLabel = METRIC_LABELS[metric] ?? metric;
  const opLabel = OPERATOR_LABELS[operator] ?? operator;
  return `when ${metricLabel} is ${opLabel} ${formatThreshold(metric, threshold)}`;
}

/** Full condition phrase for a tier, including any ANDed extra conditions. */
function tierPhrase(tier: {
  metric: string;
  operator: string;
  threshold: number;
  extraConditions?: Array<{ metric: string; operator: string; threshold: number }>;
}): string {
  let phrase = conditionPhrase(tier.metric, tier.operator, tier.threshold);
  for (const c of tier.extraConditions ?? []) {
    // Strip the leading "when " on extra conditions so they read as "... and X is ...".
    phrase += ` and ${conditionPhrase(c.metric, c.operator, c.threshold).replace(/^when /, '')}`;
  }
  return phrase;
}

export function PayrollFormulaRulesExplanation({
  formula,
}: {
  formula: PayrollFormula | null | undefined;
}) {
  if (!formula) {
    return (
      <div className="card p-4">
        <p className="text-sm text-app-fg-muted">
          No formula is linked to this pay role yet. Edit the role to add base salary and bonus rules.
        </p>
      </div>
    );
  }

  const flatBase = formula.flatBaseSalary ?? formula.flatMonthlyAmount ?? 0;
  const baseTiers = formula.baseSalaryTiers ?? [];
  const bonusTiers = formula.bonusTiers ?? [];
  const allowances = formula.allowances ?? [];
  const penalty = formula.penaltyPerReturn ?? 0;
  const floor = formula.minimumFloor;
  const scaling = formula.scalingRule;
  const subsidy = formula.employerPayeSubsidy;
  const roasPpd = formula.ppdMethod === 'ROAS';
  const roasBands = [...(formula.roasPpdTiers ?? [])].sort((a, b) => b.minRoas - a.minRoas);
  const ocBrackets = [...(formula.ocBonus?.tiers ?? [])].sort((a, b) => a.minOrders - b.minOrders);

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-app-fg">Base salary</h3>
        <p className="text-sm text-app-fg">
          Flat base: <span className="font-medium tabular-nums">{formatNaira(flatBase)}</span>
          {baseTiers.length > 0 ? ' (used when no base tier matches)' : ''}
        </p>
        {baseTiers.length === 0 ? (
          <p className="text-xs text-app-fg-muted">No conditional base tiers. Staff always get the flat base above.</p>
        ) : (
          <ul className="space-y-2">
            {baseTiers.map((tier, idx) => (
              <li
                key={`base-${idx}`}
                className="rounded-lg border border-app-border bg-app-hover/30 px-3 py-2 text-sm text-app-fg"
              >
                <span className="text-xs font-semibold text-app-fg-muted mr-2">#{idx + 1}</span>
                Pay <span className="font-medium tabular-nums">{formatNaira(tier.amount)}</span>{' '}
                {tierPhrase(tier)}.
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-app-fg-muted">
          Base tiers are checked in order. The first match wins.
        </p>
      </div>

      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-app-fg">Performance bonus</h3>
        {bonusTiers.length === 0 ? (
          <p className="text-sm text-app-fg-muted">No bonus tiers configured.</p>
        ) : (
          <ul className="space-y-2">
            {bonusTiers.map((tier, idx) => {
              const skipped = roasPpd && tier.kind === 'PER_ORDER';
              const amountLabel =
                tier.kind === 'PER_ORDER'
                  ? `${formatNaira(tier.amount)} per delivered order`
                  : formatNaira(tier.amount);
              return (
                <li
                  key={`bonus-${idx}`}
                  className="rounded-lg border border-app-border bg-app-hover/30 px-3 py-2 text-sm text-app-fg"
                >
                  <span className="text-xs font-semibold text-app-fg-muted mr-2">#{idx + 1}</span>
                  Add <span className="font-medium tabular-nums">{amountLabel}</span>{' '}
                  {tierPhrase(tier)}.
                  {skipped ? <span className="text-xs text-app-fg-muted"> Not paid: ROAS-based PPD.</span> : null}
                </li>
              );
            })}
          </ul>
        )}
        {bonusTiers.length > 0 ? (
          <p className="text-xs text-app-fg-muted">
            Tiers are checked from the highest threshold down. Only the first match pays.
          </p>
        ) : null}
      </div>

      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-app-fg">Pay per delivered order (PPD)</h3>
        {roasPpd ? (
          <>
            <p className="text-sm text-app-fg">
              ROAS-based. Payroll PPD ROAS = revenue of delivered orders where the person is the media buyer (by
              delivery date, converted at the saved month-end rate) / approved ad spend for the month.
            </p>
            <ul className="space-y-2">
              {roasBands.map((b, idx) => (
                <li
                  key={`roas-${idx}`}
                  className="rounded-lg border border-app-border bg-app-hover/30 px-3 py-2 text-sm text-app-fg"
                >
                  ROAS at least {b.minRoas}:{' '}
                  <span className="font-medium tabular-nums">{formatNaira(b.ratePerOrder)}</span> per delivered order
                </li>
              ))}
            </ul>
            <p className="text-xs text-app-fg-muted">The highest band reached pays. No ad spend means no PPD.</p>
          </>
        ) : (
          <p className="text-sm text-app-fg">Performance metrics: the per-order bonus tiers above.</p>
        )}
      </div>

      {ocBrackets.length > 0 ? (
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-app-fg">OC Bonus</h3>
          <ul className="space-y-2">
            {ocBrackets.map((t, idx) => (
              <li
                key={`oc-${idx}`}
                className="rounded-lg border border-app-border bg-app-hover/30 px-3 py-2 text-sm text-app-fg"
              >
                {t.minOrders.toLocaleString('en-NG')}+{' '}
                {formula.ocBonus?.basis === 'DELIVERED_ORDERS' ? 'delivered orders' : 'orders generated'}:{' '}
                <span className="font-medium tabular-nums">{formatNaira(t.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-app-fg-muted">Paid under either PPD method. The highest bracket reached pays.</p>
        </div>
      ) : null}

      {(allowances.length > 0 || penalty > 0 || floor || scaling || subsidy) && (
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-app-fg">Other rules</h3>
          <ul className="space-y-2 text-sm text-app-fg">
            {allowances.map((a, idx) => (
              <li key={`allow-${idx}`}>
                Allowance <span className="font-medium">{a.name}</span>:{' '}
                <span className="tabular-nums font-medium">{formatNaira(a.amount)}</span>
                {a.taxable ? ' (taxable)' : ' (non-taxable)'}
              </li>
            ))}
            {penalty > 0 ? (
              <li>
                Return penalty: subtract{' '}
                <span className="font-medium tabular-nums">{formatNaira(penalty)}</span> per returned
                order.
              </li>
            ) : null}
            {floor ? (
              <li>
                Minimum floor: {conditionPhrase(floor.metric, floor.operator, floor.threshold)}
                {floor.fallbackBonus != null
                  ? `, fallback bonus ${formatNaira(floor.fallbackBonus)}`
                  : ''}
                .
              </li>
            ) : null}
            {scaling ? (
              <li>
                Scaling: starting at {formatThreshold(scaling.metric, scaling.startThreshold)}, add{' '}
                {formatNaira(scaling.incrementAmount)} every {scaling.stepSize} points
                {scaling.capAmount != null ? `, capped at ${formatNaira(scaling.capAmount)}` : ''}.
              </li>
            ) : null}
            {subsidy ? (
              <li>
                Employer PAYE subsidy: {subsidy.subsidyPercent}%{' '}
                {conditionPhrase(subsidy.metric, subsidy.operator, subsidy.threshold)}.
              </li>
            ) : null}
          </ul>
        </div>
      )}
    </div>
  );
}
