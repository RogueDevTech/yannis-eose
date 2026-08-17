import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { AmountInput } from '~/components/ui/amount-input';
import { NairaPrice } from '~/components/ui/naira-price';
import type { PayrollFormula } from '@yannis/shared';

const METRIC_OPTIONS = [
  { value: 'INDIVIDUAL_DR', label: 'Individual DR %' },
  { value: 'TEAM_DR', label: 'Team DR %' },
  { value: 'DELIVERED_COUNT', label: 'Delivered orders (count)' },
  { value: 'QUALIFYING_REVENUE', label: 'Qualifying revenue (₦, delivered + remitted)' },
  { value: 'CPA', label: 'CPA' },
  { value: 'TARGET_MET', label: 'Target met' },
  { value: 'NONE', label: 'None (flat)' },
];

type MetricValue = (typeof METRIC_OPTIONS)[number]['value'];

function MetricSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (metric: MetricValue) => void;
}) {
  return (
    <FormSelect
      aria-label="Tier metric"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as MetricValue)}
      options={METRIC_OPTIONS}
    />
  );
}

const BONUS_GRID =
  'grid grid-cols-[1.25rem_minmax(11rem,1.5fr)_minmax(7.5rem,1fr)_4.5rem_minmax(6.5rem,0.9fr)_minmax(7rem,1fr)_1.5rem] gap-x-2 gap-y-1.5 items-center';
const BASE_GRID =
  'grid grid-cols-[1.25rem_minmax(11rem,1.5fr)_minmax(7.5rem,1fr)_4.5rem_minmax(7rem,1fr)_1.5rem] gap-x-2 gap-y-1.5 items-center';

const OPERATOR_OPTIONS = [
  { value: 'GTE', label: 'At least (≥)' },
  { value: 'GT', label: 'More than (>)' },
  { value: 'LTE', label: 'At most (≤)' },
  { value: 'LT', label: 'Less than (<)' },
  { value: 'EQ', label: 'Exactly (=)' },
];

type BaseTier = NonNullable<PayrollFormula['baseSalaryTiers']>[number];
type BonusTier = NonNullable<PayrollFormula['bonusTiers']>[number];
type TierCondition = NonNullable<BonusTier['extraConditions']>[number];

function emptyCondition(): TierCondition {
  return { metric: 'CPA', operator: 'LT', threshold: 0 };
}

/**
 * Extra AND-conditions aligned to the same column grid as the primary tier row
 * (metric / operator / threshold). Kind + amount stay on the primary row only.
 */
function TierExtraConditionRows({
  conditions,
  disabled,
  gridClass,
  trailingCols = 0,
  onChange,
}: {
  conditions: TierCondition[] | undefined;
  disabled?: boolean;
  gridClass: string;
  /** Empty cells after threshold (kind + amount on bonus, amount on base). */
  trailingCols?: number;
  onChange: (next: TierCondition[]) => void;
}) {
  const list = conditions ?? [];
  return (
    <>
      {list.map((cond, ci) => (
        <div key={`cond-${ci}`} className={gridClass}>
          <span className="text-[10px] font-bold uppercase tracking-wide text-app-fg-muted text-center">
            and
          </span>
          <MetricSelect
            value={cond.metric}
            disabled={disabled}
            onChange={(metric) =>
              onChange(list.map((c, i) => (i === ci ? { ...c, metric: metric as TierCondition['metric'] } : c)))
            }
          />
          <FormSelect
            value={cond.operator}
            disabled={disabled}
            onChange={(e) =>
              onChange(
                list.map((c, i) =>
                  i === ci ? { ...c, operator: e.target.value as TierCondition['operator'] } : c,
                ),
              )
            }
            options={OPERATOR_OPTIONS}
          />
          <TextInput
            type="number"
            value={String(cond.threshold)}
            disabled={disabled}
            onChange={(e) =>
              onChange(list.map((c, i) => (i === ci ? { ...c, threshold: Number(e.target.value) } : c)))
            }
          />
          {Array.from({ length: trailingCols }, (_, i) => (
            <span key={`pad-${i}`} aria-hidden className="block" />
          ))}
          {!disabled ? (
            <button
              type="button"
              onClick={() => onChange(list.filter((_, i) => i !== ci))}
              className="text-danger-600 hover:text-danger-500 text-base leading-none justify-self-end"
              aria-label="Remove condition"
            >
              &times;
            </button>
          ) : (
            <span aria-hidden />
          )}
        </div>
      ))}
      {!disabled && list.length < 4 ? (
        <div className={`${gridClass} !gap-y-0`}>
          <span aria-hidden />
          <button
            type="button"
            onClick={() => onChange([...list, emptyCondition()])}
            className="col-span-3 justify-self-start text-2xs font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
          >
            + AND condition
          </button>
        </div>
      ) : null}
    </>
  );
}

function TierGridHeader({
  gridClass,
  columns,
}: {
  gridClass: string;
  columns: string[];
}) {
  return (
    <div className={`${gridClass} px-2.5 pb-1 border-b border-app-border`}>
      {columns.map((label) => (
        <span
          key={label}
          className="text-micro font-semibold uppercase tracking-wide text-app-fg-muted"
        >
          {label}
        </span>
      ))}
      <span aria-hidden />
    </div>
  );
}

export interface FormulaPreviewResult {
  formulaResult: {
    baseSalary: number;
    performanceBonus: number;
    grossBeforeAdjustments: number;
    /** Per-line explanation of how the bonus was reached (which tier + math). */
    bonusBreakdown?: Array<{ label: string; amount: number; productId?: string; productName?: string }>;
    deliveryRate?: number;
    teamDeliveryRate?: number;
    cpa?: number | null;
  };
  payePreview: { monthlyPaye: number; employeePaye: number };
}

export interface FormulaPreviewSamples {
  individualDr: number;
  teamDr: number;
  cpa: number;
  deliveredCount: number;
  returnedCount: number;
  targetMet: boolean;
}

interface PayrollFormulaTierBuilderProps {
  initialFormula: PayrollFormula;
  canWrite: boolean;
  previewResult: FormulaPreviewResult | null;
  previewLoading: boolean;
  onPreview: (formula: PayrollFormula, samples: FormulaPreviewSamples) => void;
}

function emptyBaseTier(): BaseTier {
  return { metric: 'INDIVIDUAL_DR', operator: 'GTE', threshold: 0, amount: 0 };
}

function emptyBonusTier(): BonusTier {
  return { metric: 'INDIVIDUAL_DR', operator: 'GTE', threshold: 0, kind: 'FLAT', amount: 0 };
}

function parseFormula(raw: Record<string, unknown>): PayrollFormula {
  const asNumber = (v: unknown): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return undefined;
  };
  return {
    schemaVersion: 'payroll_v1',
    flatBaseSalary: asNumber(raw.flatBaseSalary),
    baseSalaryTiers: Array.isArray(raw.baseSalaryTiers) ? (raw.baseSalaryTiers as BaseTier[]) : [],
    bonusTiers: Array.isArray(raw.bonusTiers) ? (raw.bonusTiers as BonusTier[]) : [],
    penaltyPerReturn: asNumber(raw.penaltyPerReturn),
  };
}

export function buildFormulaJson(formula: PayrollFormula): string {
  return JSON.stringify({ schemaVersion: 'payroll_v1', ...formula }, null, 2);
}

export function PayrollFormulaTierBuilder({
  initialFormula,
  canWrite,
  previewResult,
  previewLoading,
  onPreview,
}: PayrollFormulaTierBuilderProps) {
  const parsed = useMemo(() => parseFormula(initialFormula as unknown as Record<string, unknown>), [initialFormula]);
  const [flatBaseSalary, setFlatBaseSalary] = useState(String(parsed.flatBaseSalary ?? ''));
  const [baseTiers, setBaseTiers] = useState<BaseTier[]>(parsed.baseSalaryTiers ?? []);
  const [bonusTiers, setBonusTiers] = useState<BonusTier[]>(parsed.bonusTiers ?? []);
  const [penaltyPerReturn, setPenaltyPerReturn] = useState(String(parsed.penaltyPerReturn ?? ''));
  const [sampleDr, setSampleDr] = useState('55');
  const [sampleTeamDr, setSampleTeamDr] = useState('52');
  const [sampleCpa, setSampleCpa] = useState('10000');
  const [sampleDelivered, setSampleDelivered] = useState('10');
  const [sampleReturned, setSampleReturned] = useState('1');
  const [sampleTargetMet, setSampleTargetMet] = useState(true);

  const formula = useMemo((): PayrollFormula => {
    const out: PayrollFormula = { schemaVersion: 'payroll_v1' };
    out.flatBaseSalary = flatBaseSalary ? Number(flatBaseSalary) : 0;
    if (baseTiers.length) out.baseSalaryTiers = baseTiers;
    if (bonusTiers.length) out.bonusTiers = bonusTiers;
    if (penaltyPerReturn) out.penaltyPerReturn = Number(penaltyPerReturn);
    return out;
  }, [flatBaseSalary, baseTiers, bonusTiers, penaltyPerReturn]);

  const samples = useMemo<FormulaPreviewSamples>(
    () => ({
      individualDr: Number(sampleDr) || 0,
      teamDr: Number(sampleTeamDr) || 0,
      cpa: Number(sampleCpa) || 0,
      deliveredCount: Number(sampleDelivered) || 0,
      returnedCount: Number(sampleReturned) || 0,
      targetMet: sampleTargetMet,
    }),
    [sampleDr, sampleTeamDr, sampleCpa, sampleDelivered, sampleReturned, sampleTargetMet],
  );

  /** Which sample inputs to show: driven only by metrics/kinds currently on the form. */
  const sampleFields = useMemo(() => {
    // Include both each tier's primary metric and any AND extra-condition metrics,
    // so e.g. a DR tier with a `CPA < 1000` extra condition surfaces the CPA input.
    const tierMetrics = (t: BaseTier | BonusTier) => [
      t.metric,
      ...(t.extraConditions ?? []).map((c) => c.metric),
    ];
    const usedMetrics = new Set([
      ...baseTiers.flatMap(tierMetrics),
      ...bonusTiers.flatMap(tierMetrics),
    ]);
    return {
      individualDr: usedMetrics.has('INDIVIDUAL_DR'),
      teamDr: usedMetrics.has('TEAM_DR'),
      cpa: usedMetrics.has('CPA'),
      targetMet: usedMetrics.has('TARGET_MET'),
      // Delivered-order count input is relevant both for PER_ORDER bonus math
      // and for any tier gated on the DELIVERED_COUNT metric.
      delivered: bonusTiers.some((t) => t.kind === 'PER_ORDER') || usedMetrics.has('DELIVERED_COUNT'),
      returned: Number(penaltyPerReturn) > 0,
    };
  }, [baseTiers, bonusTiers, penaltyPerReturn]);

  const showSamplePreview =
    baseTiers.length > 0 ||
    bonusTiers.length > 0 ||
    Number(flatBaseSalary) > 0 ||
    Number(penaltyPerReturn) > 0;

  // Live preview: recompute automatically (debounced) whenever the formula or the
  // sample inputs change, so HR never sees a stale/fixed bonus. The manual
  // "Preview" button remains for an explicit refresh. onPreview is stable
  // (useCallback in the parent) so it's safe in the dep array.
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;
  useEffect(() => {
    if (!showSamplePreview) return;
    const t = setTimeout(() => onPreviewRef.current(formula, samples), 350);
    return () => clearTimeout(t);
  }, [formula, samples, showSamplePreview]);

  const gapWarning = useMemo(() => {
    const drTiers = baseTiers.filter((t) => t.metric === 'INDIVIDUAL_DR').sort((a, b) => a.threshold - b.threshold);
    if (drTiers.length < 2) return null;
    for (let i = 1; i < drTiers.length; i += 1) {
      const prev = drTiers[i - 1]!;
      const curr = drTiers[i]!;
      if (curr.threshold > prev.threshold + 0.01 && curr.threshold - prev.threshold > 5) {
        return `Possible DR gap between ${prev.threshold}% and ${curr.threshold}% on base salary tiers.`;
      }
    }
    return null;
  }, [baseTiers]);

  return (
    <div className="space-y-3">
      <input type="hidden" name="rulesJson" value={buildFormulaJson(formula)} readOnly />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <LabelWithInfo
            htmlFor="flatBaseSalary"
            label="Base salary"
            info="Guaranteed monthly base salary for this role. Every staff member on this pay role receives at least this amount."
          />
          <AmountInput
            id="flatBaseSalary"
            name="_flatBaseSalaryUi"
            prefix="NGN"
            className="input w-full"
            value={flatBaseSalary}
            onChange={(v) => setFlatBaseSalary(v)}
            disabled={!canWrite}
            required
          />
        </div>
        <div>
          <LabelWithInfo
            htmlFor="penaltyPerReturn"
            label="Penalty per return"
            info="Amount deducted from payout for each returned order. Applied after bonus calculation."
          />
          <AmountInput
            id="penaltyPerReturn"
            name="_penaltyUi"
            prefix="NGN"
            className="input w-full"
            value={penaltyPerReturn}
            onChange={(v) => setPenaltyPerReturn(v)}
            disabled={!canWrite}
          />
        </div>
      </div>

      <TierSection
        title="Base salary tiers"
        info={"Conditional salary rules based on performance metrics. The first matching tier sets the base salary. If none match, the flat base salary above is used.\n\nMetric options:\n\u2022 Individual DR %: The closer's personal delivery rate (their delivered orders / their total orders).\n\u2022 Team DR %: The entire branch team's delivery rate for the period.\n\u2022 CPA: Cost Per Acquisition in NGN. Lower is better, calculated as total ad spend / confirmed orders.\n\u2022 Target met: Whether the closer hit their assigned delivery target for the period (yes/no).\n\u2022 None (flat): Fixed amount, no metric condition required."}
        canWrite={canWrite}
        emptyLabel="No base tiers: flat base salary or plan defaults apply."
        onAdd={() => setBaseTiers((rows) => [...rows, emptyBaseTier()])}
        hasRows={baseTiers.length > 0}
      >
        {baseTiers.length > 0 ? (
          <div className="overflow-x-auto space-y-2">
            <TierGridHeader
              gridClass={BASE_GRID}
              columns={['#', 'Metric', 'Operator', 'Threshold', 'Amount']}
            />
            {baseTiers.map((tier, idx) => (
              <div
                key={`base-${idx}`}
                className="rounded-lg border border-app-border bg-app-canvas/40 px-2.5 py-2 space-y-1.5 min-w-[36rem]"
              >
                <div className={BASE_GRID}>
                  <span className="text-xs font-semibold text-app-fg-muted tabular-nums text-center">
                    {idx + 1}
                  </span>
                  <MetricSelect
                    value={tier.metric}
                    disabled={!canWrite}
                    onChange={(metric) =>
                      setBaseTiers((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, metric: metric as BaseTier['metric'] } : r)),
                      )
                    }
                  />
                  <FormSelect
                    value={tier.operator}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setBaseTiers((rows) =>
                        rows.map((r, i) =>
                          i === idx ? { ...r, operator: e.target.value as BaseTier['operator'] } : r,
                        ),
                      )
                    }
                    options={OPERATOR_OPTIONS}
                  />
                  <TextInput
                    type="number"
                    value={String(tier.threshold)}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setBaseTiers((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, threshold: Number(e.target.value) } : r)),
                      )
                    }
                  />
                  <AmountInput
                    prefix="NGN"
                    className="input w-full"
                    value={String(tier.amount)}
                    disabled={!canWrite}
                    onChange={(v) =>
                      setBaseTiers((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, amount: Number(v) || 0 } : r)),
                      )
                    }
                  />
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => setBaseTiers((rows) => rows.filter((_, i) => i !== idx))}
                      className="text-danger-600 hover:text-danger-500 text-base leading-none justify-self-end"
                      aria-label="Remove tier"
                    >
                      &times;
                    </button>
                  ) : (
                    <span aria-hidden />
                  )}
                </div>
                <TierExtraConditionRows
                  conditions={tier.extraConditions}
                  disabled={!canWrite}
                  gridClass={BASE_GRID}
                  trailingCols={1}
                  onChange={(next) =>
                    setBaseTiers((rows) =>
                      rows.map((r, i) =>
                        i === idx ? { ...r, extraConditions: next.length ? next : undefined } : r,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>
        ) : null}
      </TierSection>

      {gapWarning ? (
        <p className="text-xs text-warning-700 dark:text-warning-300 rounded-md border border-warning-300 bg-warning-50 dark:bg-warning-900/20 px-3 py-2">
          {gapWarning}
        </p>
      ) : null}

      <TierSection
        title="Performance bonus tiers"
        info={"Extra pay earned when staff hit delivery or sales targets. Each matching tier adds its amount on top of the base salary.\n\nMetric options:\n\u2022 Individual DR %: The closer's personal delivery rate (their delivered orders / their total orders).\n\u2022 Team DR %: The entire branch team's delivery rate for the period.\n\u2022 CPA: Cost Per Acquisition in NGN. Lower is better, calculated as total ad spend / confirmed orders.\n\u2022 Target met: Whether the closer hit their assigned delivery target for the period (yes/no).\n\u2022 None (flat): Fixed bonus amount, no metric condition required."}
        canWrite={canWrite}
        emptyLabel="No bonus tiers configured."
        onAdd={() => setBonusTiers((rows) => [...rows, emptyBonusTier()])}
        hasRows={bonusTiers.length > 0}
      >
        {bonusTiers.length > 0 ? (
          <div className="overflow-x-auto space-y-2">
            <TierGridHeader
              gridClass={BONUS_GRID}
              columns={['#', 'Metric', 'Operator', 'Thresh.', 'Kind', 'Amount']}
            />
            {bonusTiers.map((tier, idx) => (
              <div
                key={`bonus-${idx}`}
                className="rounded-lg border border-app-border bg-app-canvas/40 px-2.5 py-2 space-y-1.5 min-w-[42rem]"
              >
                <div className={BONUS_GRID}>
                  <span className="text-xs font-semibold text-app-fg-muted tabular-nums text-center">
                    {idx + 1}
                  </span>
                  <MetricSelect
                    value={tier.metric}
                    disabled={!canWrite}
                    onChange={(metric) =>
                      setBonusTiers((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, metric: metric as BonusTier['metric'] } : r)),
                      )
                    }
                  />
                  <FormSelect
                    value={tier.operator}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setBonusTiers((rows) =>
                        rows.map((r, i) =>
                          i === idx ? { ...r, operator: e.target.value as BonusTier['operator'] } : r,
                        ),
                      )
                    }
                    options={OPERATOR_OPTIONS}
                  />
                  <TextInput
                    type="number"
                    value={String(tier.threshold)}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setBonusTiers((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, threshold: Number(e.target.value) } : r)),
                      )
                    }
                  />
                  <FormSelect
                    value={tier.kind}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setBonusTiers((rows) =>
                        rows.map((r, i) =>
                          i === idx ? { ...r, kind: e.target.value as BonusTier['kind'] } : r,
                        ),
                      )
                    }
                    options={[
                      { value: 'FLAT', label: 'Flat' },
                      { value: 'PER_ORDER', label: 'Per order' },
                    ]}
                  />
                  <AmountInput
                    prefix="NGN"
                    className="input w-full"
                    value={String(tier.amount)}
                    disabled={!canWrite}
                    onChange={(v) =>
                      setBonusTiers((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, amount: Number(v) || 0 } : r)),
                      )
                    }
                  />
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => setBonusTiers((rows) => rows.filter((_, i) => i !== idx))}
                      className="text-danger-600 hover:text-danger-500 text-base leading-none justify-self-end"
                      aria-label="Remove tier"
                    >
                      &times;
                    </button>
                  ) : (
                    <span aria-hidden />
                  )}
                </div>
                <TierExtraConditionRows
                  conditions={tier.extraConditions}
                  disabled={!canWrite}
                  gridClass={BONUS_GRID}
                  trailingCols={2}
                  onChange={(next) =>
                    setBonusTiers((rows) =>
                      rows.map((r, i) =>
                        i === idx ? { ...r, extraConditions: next.length ? next : undefined } : r,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>
        ) : null}
      </TierSection>

      {!showSamplePreview ? null : (
        <div className="card !p-3 space-y-2">
          <h3 className="text-sm font-semibold text-app-fg">Sample preview</h3>
          <p className="text-xs text-app-fg-muted">
            Inputs appear for metrics used in your tiers (and for per-order / return penalties).
          </p>
          <div className="grid grid-cols-2 gap-3 max-w-lg">
            {sampleFields.individualDr && (
              <TextInput
                label="Sample individual DR %"
                type="number"
                min={0}
                max={100}
                value={sampleDr}
                onChange={(e) => setSampleDr(e.target.value)}
              />
            )}
            {sampleFields.teamDr && (
              <TextInput
                label="Sample team DR %"
                type="number"
                min={0}
                max={100}
                value={sampleTeamDr}
                onChange={(e) => setSampleTeamDr(e.target.value)}
              />
            )}
            {sampleFields.cpa && (
              <TextInput
                label="Sample CPA (NGN)"
                type="number"
                min={0}
                value={sampleCpa}
                onChange={(e) => setSampleCpa(e.target.value)}
              />
            )}
            {sampleFields.delivered && (
              <TextInput
                label="Sample delivered orders"
                type="number"
                min={0}
                value={sampleDelivered}
                onChange={(e) => setSampleDelivered(e.target.value)}
              />
            )}
            {sampleFields.returned && (
              <TextInput
                label="Sample returned orders"
                type="number"
                min={0}
                value={sampleReturned}
                onChange={(e) => setSampleReturned(e.target.value)}
              />
            )}
            {sampleFields.targetMet && (
              <label className="flex items-center gap-2 text-sm text-app-fg col-span-2 pt-1">
                <input
                  type="checkbox"
                  checked={sampleTargetMet}
                  onChange={(e) => setSampleTargetMet(e.target.checked)}
                  className="rounded border-app-border text-brand-600 focus:ring-brand-500"
                />
                Sample: target met
              </label>
            )}
            {!sampleFields.individualDr &&
              !sampleFields.teamDr &&
              !sampleFields.cpa &&
              !sampleFields.delivered &&
              !sampleFields.returned &&
              !sampleFields.targetMet && (
                <p className="text-sm text-app-fg-muted col-span-2">
                  No metric-based tiers yet. Preview uses flat base / allowances only.
                </p>
              )}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={previewLoading}
            loadingText="Previewing…"
            onClick={() => onPreview(formula, samples)}
          >
            Refresh preview
          </Button>
          {/* Insufficient data: a PER_ORDER tier needs a delivered-order count. */}
          {bonusTiers.some((t) => t.kind === 'PER_ORDER') && samples.deliveredCount <= 0 ? (
            <p className="text-sm text-warning-700 dark:text-warning-400">
              Insufficient data to calculate bonus: a per-order tier is configured but Sample Delivered Orders is 0.
            </p>
          ) : previewResult ? (
            <div className={`space-y-2 text-sm transition-opacity ${previewLoading ? 'opacity-50' : ''}`}>
              {/* Performance-bonus explanation: which tier matched + the math. */}
              <div className="rounded-md border border-app-border bg-app-hover/40 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">Performance bonus</p>
                {previewResult.formulaResult.bonusBreakdown?.length ? (
                  <ul className="mt-1.5 space-y-1">
                    {previewResult.formulaResult.bonusBreakdown.map((line, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 text-app-fg">
                        <span className="min-w-0 truncate text-app-fg-muted">{line.label}</span>
                        <span className="shrink-0 tabular-nums"><NairaPrice amount={line.amount} /></span>
                      </li>
                    ))}
                    <li className="flex items-center justify-between gap-3 border-t border-app-border pt-1 font-semibold text-app-fg">
                      <span>Total bonus</span>
                      <span className="tabular-nums"><NairaPrice amount={previewResult.formulaResult.performanceBonus} /></span>
                    </li>
                  </ul>
                ) : (
                  <p className="mt-1 text-app-fg-muted">
                    No bonus tier matched these sample metrics: bonus is{' '}
                    <NairaPrice amount={previewResult.formulaResult.performanceBonus} />.
                  </p>
                )}
              </div>

              <div className="text-app-fg-muted space-y-1">
                <p>
                  Base: <NairaPrice amount={previewResult.formulaResult.baseSalary} /> · Bonus:{' '}
                  <NairaPrice amount={previewResult.formulaResult.performanceBonus} /> · Gross:{' '}
                  <NairaPrice amount={previewResult.formulaResult.grossBeforeAdjustments} />
                </p>
                <p>
                  Est. PAYE: <NairaPrice amount={previewResult.payePreview.employeePaye} /> · Net:{' '}
                  <NairaPrice
                    amount={
                      previewResult.formulaResult.grossBeforeAdjustments -
                      previewResult.payePreview.employeePaye
                    }
                  />
                </p>
                <p className="font-semibold text-app-fg pt-1 border-t border-app-border">
                  Total payout:{' '}
                  <NairaPrice
                    amount={
                      previewResult.formulaResult.grossBeforeAdjustments -
                      previewResult.payePreview.employeePaye
                    }
                  />
                </p>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function InfoButton({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className="ml-1 inline-flex items-center justify-center rounded-full text-app-fg-muted hover:text-app-fg transition-colors"
        aria-label={`Info: ${label}`}
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10" />
          <path strokeLinecap="round" d="M12 16v-4M12 8h.01" />
        </svg>
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} maxWidth="max-w-sm" backdropBlur contentClassName="p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold text-app-fg">{label}</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-app-fg-muted hover:text-app-fg p-1 shrink-0"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-app-fg-muted">{text}</p>
        </Modal>
      )}
    </>
  );
}

function LabelWithInfo({ htmlFor, label, info }: { htmlFor: string; label: string; info: string }) {
  return (
    <label htmlFor={htmlFor} className="flex items-center text-sm font-medium text-app-fg-muted mb-1">
      {label}
      <InfoButton label={label} text={info} />
    </label>
  );
}

function TierSection({
  title,
  info,
  canWrite,
  emptyLabel,
  onAdd,
  hasRows,
  children,
}: {
  title: string;
  info?: string;
  canWrite: boolean;
  emptyLabel: string;
  onAdd: () => void;
  hasRows: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="card !p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-app-fg flex items-center">
          {title}
          {info && <InfoButton label={title} text={info} />}
        </h3>
        {canWrite ? (
          <Button type="button" variant="secondary" size="sm" onClick={onAdd}>
            Add tier
          </Button>
        ) : null}
      </div>
      {children}
      {!hasRows ? <p className="text-xs text-app-fg-muted">{emptyLabel}</p> : null}
    </div>
  );
}

