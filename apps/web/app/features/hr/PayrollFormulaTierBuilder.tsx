import { useMemo, useState } from 'react';
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
  { value: 'CPA', label: 'CPA' },
  { value: 'TARGET_MET', label: 'Target met' },
  { value: 'NONE', label: 'None (flat)' },
];

const OPERATOR_OPTIONS = [
  { value: 'GTE', label: 'At least (≥)' },
  { value: 'GT', label: 'More than (>)' },
  { value: 'LTE', label: 'At most (≤)' },
  { value: 'LT', label: 'Less than (<)' },
  { value: 'EQ', label: 'Exactly (=)' },
];

type BaseTier = NonNullable<PayrollFormula['baseSalaryTiers']>[number];
type BonusTier = NonNullable<PayrollFormula['bonusTiers']>[number];

export interface FormulaPreviewResult {
  formulaResult: {
    baseSalary: number;
    performanceBonus: number;
    grossBeforeAdjustments: number;
  };
  payePreview: { monthlyPaye: number; employeePaye: number };
}

interface PayrollFormulaTierBuilderProps {
  initialFormula: PayrollFormula;
  canWrite: boolean;
  previewResult: FormulaPreviewResult | null;
  previewLoading: boolean;
  onPreview: (formula: PayrollFormula, sampleDr: number, sampleTeamDr: number) => void;
}

function emptyBaseTier(): BaseTier {
  return { metric: 'INDIVIDUAL_DR', operator: 'GTE', threshold: 0, amount: 0 };
}

function emptyBonusTier(): BonusTier {
  return { metric: 'INDIVIDUAL_DR', operator: 'GTE', threshold: 0, kind: 'FLAT', amount: 0 };
}

function parseFormula(raw: Record<string, unknown>): PayrollFormula {
  return {
    schemaVersion: 'payroll_v1',
    flatBaseSalary: typeof raw.flatBaseSalary === 'number' ? raw.flatBaseSalary : undefined,
    baseSalaryTiers: Array.isArray(raw.baseSalaryTiers) ? (raw.baseSalaryTiers as BaseTier[]) : [],
    bonusTiers: Array.isArray(raw.bonusTiers) ? (raw.bonusTiers as BonusTier[]) : [],
    penaltyPerReturn: typeof raw.penaltyPerReturn === 'number' ? raw.penaltyPerReturn : undefined,
    perProductBonus: raw.perProductBonus === true,
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

  const formula = useMemo((): PayrollFormula => {
    const out: PayrollFormula = { schemaVersion: 'payroll_v1' };
    if (flatBaseSalary) out.flatBaseSalary = Number(flatBaseSalary);
    if (baseTiers.length) out.baseSalaryTiers = baseTiers;
    if (bonusTiers.length) out.bonusTiers = bonusTiers;
    if (penaltyPerReturn) out.penaltyPerReturn = Number(penaltyPerReturn);
    return out;
  }, [flatBaseSalary, baseTiers, bonusTiers, penaltyPerReturn]);

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

  const hasTierChildren = baseTiers.length > 0 || bonusTiers.length > 0;

  return (
    <div className="space-y-3">
      <input type="hidden" name="rulesJson" value={buildFormulaJson(formula)} readOnly />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <LabelWithInfo
            htmlFor="flatBaseSalary"
            label="Flat base salary (optional fallback)"
            info="A fixed salary paid when no tier conditions match. Acts as a safety net so staff always receive at least this amount."
          />
          <AmountInput
            id="flatBaseSalary"
            name="_flatBaseSalaryUi"
            prefix="NGN"
            className="input w-full"
            value={flatBaseSalary}
            onChange={(v) => setFlatBaseSalary(v)}
            disabled={!canWrite}
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
        info="Conditional salary rules based on performance metrics. The first matching tier sets the base salary. If none match, the flat base salary above is used."
        canWrite={canWrite}
        emptyLabel="No base tiers: flat base salary or plan defaults apply."
        onAdd={() => setBaseTiers((rows) => [...rows, emptyBaseTier()])}
        hasRows={baseTiers.length > 0}
      >
        {baseTiers.length > 0 && (
          <div className="overflow-x-auto -mx-3 sm:mx-0">
            <table className="min-w-full border-separate border-spacing-y-1 px-3 sm:px-0">
              <thead>
                <tr className="text-left">
                  <th className="px-1 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted w-8">#</th>
                  <th className="px-1 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted min-w-[140px]">Metric</th>
                  <th className="px-1 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted min-w-[140px]">Operator</th>
                  <th className="px-1 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted min-w-[90px]">Threshold</th>
                  <th className="px-1 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted min-w-[120px]">Amount (NGN)</th>
                  {canWrite && <th className="px-1 pb-1 w-8" aria-label="Remove" />}
                </tr>
              </thead>
              <tbody>
                {baseTiers.map((tier, idx) => (
                  <tr key={`base-${idx}`} className="align-top">
                    <td className="px-1 py-0.5 text-xs font-semibold text-app-fg-muted tabular-nums">{idx + 1}</td>
                    <td className="px-1 py-0.5">
                      <FormSelect value={tier.metric} disabled={!canWrite} onChange={(e) => setBaseTiers((rows) => rows.map((r, i) => (i === idx ? { ...r, metric: e.target.value as BaseTier['metric'] } : r)))} options={METRIC_OPTIONS} />
                    </td>
                    <td className="px-1 py-0.5">
                      <FormSelect value={tier.operator} disabled={!canWrite} onChange={(e) => setBaseTiers((rows) => rows.map((r, i) => (i === idx ? { ...r, operator: e.target.value as BaseTier['operator'] } : r)))} options={OPERATOR_OPTIONS} />
                    </td>
                    <td className="px-1 py-0.5">
                      <TextInput type="number" value={String(tier.threshold)} disabled={!canWrite} onChange={(e) => setBaseTiers((rows) => rows.map((r, i) => (i === idx ? { ...r, threshold: Number(e.target.value) } : r)))} />
                    </td>
                    <td className="px-1 py-0.5">
                      <AmountInput prefix="NGN" className="input w-full" value={String(tier.amount)} disabled={!canWrite} onChange={(v) => setBaseTiers((rows) => rows.map((r, i) => (i === idx ? { ...r, amount: Number(v) || 0 } : r)))} />
                    </td>
                    {canWrite && (
                      <td className="px-1 py-0.5 text-right">
                        <button type="button" onClick={() => setBaseTiers((rows) => rows.filter((_, i) => i !== idx))} className="text-danger-600 hover:text-danger-500 text-lg leading-none" aria-label="Remove tier">&times;</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TierSection>

      {gapWarning ? (
        <p className="text-xs text-warning-700 dark:text-warning-300 rounded-md border border-warning-300 bg-warning-50 dark:bg-warning-900/20 px-3 py-2">
          {gapWarning}
        </p>
      ) : null}

      <TierSection
        title="Performance bonus tiers"
        info="Extra pay earned when staff hit delivery or sales targets. Each matching tier adds its amount on top of the base salary."
        canWrite={canWrite}
        emptyLabel="No bonus tiers configured."
        onAdd={() => setBonusTiers((rows) => [...rows, emptyBonusTier()])}
        hasRows={bonusTiers.length > 0}
      >
        {bonusTiers.length > 0 && (
          <div className="overflow-x-auto -mx-3 sm:mx-0">
            <table className="min-w-full border-separate border-spacing-y-1 px-3 sm:px-0">
              <thead>
                <tr className="text-left">
                  <th className="px-1 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted w-8">#</th>
                  <th className="px-1 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted min-w-[140px]">Metric</th>
                  <th className="px-1 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted min-w-[140px]">Operator</th>
                  <th className="px-1 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted min-w-[90px]">Threshold</th>
                  <th className="px-1 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted min-w-[110px]">Kind</th>
                  <th className="px-1 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted min-w-[120px]">Amount (NGN)</th>
                  {canWrite && <th className="px-1 pb-1 w-8" aria-label="Remove" />}
                </tr>
              </thead>
              <tbody>
                {bonusTiers.map((tier, idx) => (
                  <tr key={`bonus-${idx}`} className="align-top">
                    <td className="px-1 py-0.5 text-xs font-semibold text-app-fg-muted tabular-nums">{idx + 1}</td>
                    <td className="px-1 py-0.5">
                      <FormSelect value={tier.metric} disabled={!canWrite} onChange={(e) => setBonusTiers((rows) => rows.map((r, i) => (i === idx ? { ...r, metric: e.target.value as BonusTier['metric'] } : r)))} options={METRIC_OPTIONS} />
                    </td>
                    <td className="px-1 py-0.5">
                      <FormSelect value={tier.operator} disabled={!canWrite} onChange={(e) => setBonusTiers((rows) => rows.map((r, i) => (i === idx ? { ...r, operator: e.target.value as BonusTier['operator'] } : r)))} options={OPERATOR_OPTIONS} />
                    </td>
                    <td className="px-1 py-0.5">
                      <TextInput type="number" value={String(tier.threshold)} disabled={!canWrite} onChange={(e) => setBonusTiers((rows) => rows.map((r, i) => (i === idx ? { ...r, threshold: Number(e.target.value) } : r)))} />
                    </td>
                    <td className="px-1 py-0.5">
                      <FormSelect value={tier.kind} disabled={!canWrite} onChange={(e) => setBonusTiers((rows) => rows.map((r, i) => (i === idx ? { ...r, kind: e.target.value as BonusTier['kind'] } : r)))} options={[{ value: 'FLAT', label: 'Flat amount' }, { value: 'PER_ORDER', label: 'Per order' }]} />
                    </td>
                    <td className="px-1 py-0.5">
                      <AmountInput prefix="NGN" className="input w-full" value={String(tier.amount)} disabled={!canWrite} onChange={(v) => setBonusTiers((rows) => rows.map((r, i) => (i === idx ? { ...r, amount: Number(v) || 0 } : r)))} />
                    </td>
                    {canWrite && (
                      <td className="px-1 py-0.5 text-right">
                        <button type="button" onClick={() => setBonusTiers((rows) => rows.filter((_, i) => i !== idx))} className="text-danger-600 hover:text-danger-500 text-lg leading-none" aria-label="Remove tier">&times;</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TierSection>

      {!hasTierChildren ? null : (() => {
        const usedMetrics = new Set([
          ...baseTiers.map((t) => t.metric),
          ...bonusTiers.map((t) => t.metric),
        ]);
        const needsIndividualDr = usedMetrics.has('INDIVIDUAL_DR') || usedMetrics.size === 0;
        const needsTeamDr = usedMetrics.has('TEAM_DR');
        return (
        <div className="card !p-3 space-y-2">
          <h3 className="text-sm font-semibold text-app-fg">Sample preview</h3>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            {needsIndividualDr && (
              <TextInput
                label="Sample individual DR %"
                type="number"
                min={0}
                max={100}
                value={sampleDr}
                onChange={(e) => setSampleDr(e.target.value)}
              />
            )}
            {needsTeamDr && (
              <TextInput
                label="Sample team DR %"
                type="number"
                min={0}
                max={100}
                value={sampleTeamDr}
                onChange={(e) => setSampleTeamDr(e.target.value)}
              />
            )}
            {!needsIndividualDr && !needsTeamDr && (
              <p className="text-sm text-app-fg-muted col-span-2">No DR-based tiers. Preview uses flat values only.</p>
            )}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={previewLoading}
            loadingText="Previewing…"
            onClick={() => onPreview(formula, Number(sampleDr), Number(sampleTeamDr))}
          >
            Preview against sample metrics
          </Button>
          {previewResult ? (
            <div className="text-sm text-app-fg-muted space-y-1">
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
            </div>
          ) : null}
        </div>
        );
      })()}
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

