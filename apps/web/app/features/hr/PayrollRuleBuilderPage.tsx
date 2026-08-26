import { useCallback, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { useFetcherToast } from '~/components/ui/toast';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import type { CommissionPlan } from './types';
import type { PayRole } from './payroll-prd-types';
import {
  PayrollFormulaTierBuilder,
  type FormulaPreviewResult,
  type FormulaPreviewSamples,
} from './PayrollFormulaTierBuilder';
import type { PayrollFormula } from '@yannis/shared';

interface PayrollRuleBuilderPageProps {
  payRole: PayRole | null;
  plan: CommissionPlan | null;
  canWrite: boolean;
}

const CATEGORY_OPTIONS = [
  { value: 'CS_CLOSER', label: 'CS Closer' },
  { value: 'HEAD_OF_CS', label: 'Head of CS' },
  { value: 'MEDIA_BUYER', label: 'Media Buyer' },
  { value: 'HEAD_OF_MARKETING', label: 'Head of Marketing' },
  { value: 'HEAD_OF_LOGISTICS', label: 'Head of Logistics' },
  { value: 'STOCK_MANAGER', label: 'Stock Manager' },
  { value: 'TPL_MANAGER', label: 'TPL Manager' },
  { value: 'FINANCE_OFFICER', label: 'Finance Officer' },
  { value: 'HR_MANAGER', label: 'HR Manager' },
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'BRANCH_ADMIN', label: 'Branch Admin' },
  { value: 'AUDITOR', label: 'Auditor' },
  { value: 'CONTRACTOR', label: 'Contractor' },
  { value: 'CS', label: 'CS (legacy)' },
  { value: 'MEDIA_BUYING', label: 'Media Buying (legacy)' },
  { value: 'LOGISTICS', label: 'Logistics (legacy)' },
  { value: 'OPERATIONS', label: 'Operations (legacy)' },
  { value: 'SUPPORT', label: 'Support (legacy)' },
  { value: 'LEADERSHIP', label: 'Leadership (legacy)' },
  { value: 'FINANCE', label: 'Finance (legacy)' },
  { value: 'HR_ADMIN', label: 'HR & Admin (legacy)' },
  { value: 'STOCK_MANAGEMENT', label: 'Stock Management (legacy)' },
];

export function PayrollRuleBuilderPage({ payRole, plan, canWrite }: PayrollRuleBuilderPageProps) {
  const isCreate = !payRole;
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const previewFetcher = useFetcher<{ preview?: FormulaPreviewResult; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const initialRules = (plan?.rules ?? {}) as PayrollFormula;

  // Role metadata state
  const [reportsToRequired, setReportsToRequired] = useState(payRole?.reportsToRequired ?? false);
  const [category, setCategory] = useState(payRole?.category ?? '');
  const [defaultTaxStatus, setDefaultTaxStatus] = useState(
    payRole?.defaultTaxStatus ?? 'STANDARD_PAYE',
  );
  const [deliveredMetricSource, setDeliveredMetricSource] = useState(
    payRole?.deliveredMetricSource ?? 'FUNNEL',
  );

  useFetcherToast(fetcher.data, {
    successMessage: isCreate ? 'Pay role created' : 'Formula saved',
  });

  const effectiveLabel = useMemo(() => {
    if (!plan) return null;
    const from = new Date(plan.effectiveFrom).toLocaleDateString('en-NG', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const to = plan.effectiveTo
      ? new Date(plan.effectiveTo).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Ongoing';
    return `${plan.planName} \u00b7 Effective ${from}: ${to}`;
  }, [plan]);

  const handlePreview = useCallback(
    (formula: PayrollFormula, samples: FormulaPreviewSamples) => {
      previewFetcher.submit(
        {
          intent: 'previewFormula',
          formulaJson: JSON.stringify(formula),
          sampleDr: String(samples.individualDr),
          sampleTeamDr: String(samples.teamDr),
          sampleCpa: String(samples.cpa),
          sampleDeliveredCount: String(samples.deliveredCount),
          sampleReturnedCount: String(samples.returnedCount),
          sampleQualifyingRevenue: String(samples.qualifyingRevenue),
          sampleTargetMet: samples.targetMet ? 'true' : 'false',
        },
        { method: 'post' },
      );
    },
    [previewFetcher],
  );

  const previewResult =
    previewFetcher.data && 'preview' in previewFetcher.data ? previewFetcher.data.preview ?? null : null;

  const intent = isCreate ? 'createPayRoleWithFormula' : 'saveFormulaConfig';
  const backTo = isCreate ? '/hr/payroll/config/roles' : `/hr/payroll/config/rules/${payRole.id}`;

  return (
    <div className="space-y-3">
      <PageHeader
        title={isCreate ? 'Create pay role' : `Edit · ${payRole.name}`}
        backTo={backTo}
        mobileInlineActions
        description={
          isCreate
            ? 'Define a pay role and its formula rules.'
            : effectiveLabel ?? undefined
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Formula builder toolbar"
            desktop={<PageRefreshButton />}
          />
        }
      />

      <MobileDateFilterRow hideDate />

      <ModalFetcherInlineError message={surface.errorMatchingIntent(intent)} />

      <fetcher.Form method="post" className="space-y-5">
        <input type="hidden" name="intent" value={intent} />
        {payRole && <input type="hidden" name="payRoleId" value={payRole.id} />}
        <input type="hidden" name="planName" value={plan?.planName ?? (payRole ? `${payRole.name} Formula` : 'Formula')} />
        <input type="hidden" name="effectiveFrom" value={new Date().toISOString().slice(0, 10)} />
        <input type="hidden" name="reportsToRequired" value={String(reportsToRequired)} />
        {/* Per-product bonus removed — bonuses are role-level only. */}
        <input type="hidden" name="perProductBonus" value="false" />

        {/* ── Role metadata ────────────────────────────────── */}
        {canWrite ? (
          <div className="card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-app-fg">Role details</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput
                label="Name"
                name="name"
                required
                minLength={2}
                maxLength={200}
                defaultValue={payRole?.name ?? ''}
                placeholder="e.g. Sales Closer (CS)"
              />
              <FormSelect
                label="Category"
                name="category"
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Select category..."
                options={CATEGORY_OPTIONS}
              />
              <FormSelect
                label="Tax"
                name="defaultTaxStatus"
                value={defaultTaxStatus}
                onChange={(e) => setDefaultTaxStatus(e.target.value)}
                options={[
                  { value: 'STANDARD_PAYE', label: 'Standard PAYE' },
                  { value: 'EMPLOYER_SUBSIDIZED_PAYE', label: 'Employer subsidized PAYE' },
                  { value: 'GROSS_NO_DEDUCTION', label: 'None (no tax)' },
                ]}
                hint="Applies to all staff and contractors on this pay role. Choose None to skip PAYE."
              />
              <FormSelect
                label="Delivered source"
                name="deliveredMetricSource"
                value={deliveredMetricSource}
                onChange={(e) => setDeliveredMetricSource(e.target.value)}
                options={[
                  { value: 'FUNNEL', label: 'Funnel orders' },
                  { value: 'RECOVERY_COMBINED', label: 'Recovery (cart + delivered follow-up)' },
                ]}
                hint="Which deliveries count toward pay. Recovery covers cart orders plus delivered follow-up orders. Use it for the Follow-up on Delivered Orders category."
              />
            </div>
          </div>
        ) : (
          <div className="card p-4 space-y-2">
            <h3 className="text-sm font-semibold text-app-fg">{payRole?.name}</h3>
          </div>
        )}

        {/* ── Formula tiers ────────────────────────────────── */}
        {canWrite ? (
          <PayrollFormulaTierBuilder
            initialFormula={initialRules}
            canWrite={canWrite}
            previewResult={previewResult}
            previewLoading={previewFetcher.state !== 'idle'}
            onPreview={handlePreview}
          />
        ) : (
          <div className="card p-4">
            <pre className="text-xs text-app-fg-muted whitespace-pre-wrap font-mono overflow-x-auto">
              {JSON.stringify(initialRules, null, 2)}
            </pre>
          </div>
        )}

        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Saving…">
              {isCreate ? 'Create pay role' : 'Save formula (new version)'}
            </Button>
          </div>
        ) : null}
      </fetcher.Form>

      {/* ── Attendance base-salary deduction (separate save) ─────────── */}
      {payRole && canWrite ? (
        <AttendanceDeductionCard payRoleId={payRole.id} config={payRole.attendanceConfig ?? null} />
      ) : null}
    </div>
  );
}

type AttendanceBand = { minAbsences: number; deductionPercent: number };

/**
 * Per-role attendance base-salary deduction editor. Saves independently of the
 * formula via the `saveAttendanceBands` intent → `attendance.savePayRoleConfig`.
 * When enabled, an over-limit absence count cuts the base by the matched band's
 * percent (e.g. Remote MB: 5 absences → 100% cut). PAYE follows the reduced base.
 */
function AttendanceDeductionCard({
  payRoleId,
  config,
}: {
  payRoleId: string;
  config: { enabled: boolean; bands: AttendanceBand[] } | null;
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const [enabled, setEnabled] = useState(config?.enabled ?? false);
  const [bands, setBands] = useState<AttendanceBand[]>(
    config?.bands?.length ? config.bands : [{ minAbsences: 5, deductionPercent: 100 }],
  );

  useFetcherToast(fetcher.data, { successMessage: 'Attendance deduction saved' });

  const setBand = useCallback((i: number, patch: Partial<AttendanceBand>) => {
    setBands((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }, []);
  const addBand = useCallback(() => {
    setBands((prev) => [...prev, { minAbsences: 0, deductionPercent: 0 }]);
  }, []);
  const removeBand = useCallback((i: number) => {
    setBands((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  const payload = JSON.stringify({
    enabled,
    bands: bands
      .map((b) => ({
        minAbsences: Math.max(0, Math.min(31, Math.trunc(Number(b.minAbsences) || 0))),
        deductionPercent: Math.max(0, Math.min(100, Number(b.deductionPercent) || 0)),
      }))
      .sort((a, b) => a.minAbsences - b.minAbsences),
  });

  return (
    <fetcher.Form method="post" className="card p-4 space-y-3">
      <input type="hidden" name="intent" value="saveAttendanceBands" />
      <input type="hidden" name="payRoleId" value={payRoleId} />
      <input type="hidden" name="configJson" value={payload} />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-app-fg">Attendance deduction</h3>
          <p className="text-xs text-app-fg-muted">
            Reduce base salary when a staff member's monthly absences reach a band. Bonuses
            and add-ons are unaffected. PAYE follows the reduced base.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-app-fg whitespace-nowrap">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          Enabled
        </label>
      </div>

      {enabled ? (
        <div className="space-y-2">
          {bands.map((band, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <TextInput
                label={i === 0 ? 'Absences ≥' : undefined}
                type="number"
                min={0}
                max={31}
                value={String(band.minAbsences)}
                onChange={(e) => setBand(i, { minAbsences: Number(e.target.value) })}
                className="w-24"
              />
              <TextInput
                label={i === 0 ? 'Deduct %' : undefined}
                type="number"
                min={0}
                max={100}
                value={String(band.deductionPercent)}
                onChange={(e) => setBand(i, { deductionPercent: Number(e.target.value) })}
                className="w-24"
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => removeBand(i)}>
                Remove
              </Button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={addBand}>
            Add band
          </Button>
          <p className="text-2xs text-app-fg-muted">
            Example: one band of Absences ≥ 5, Deduct 100% removes the whole base once a
            staff member hits 5 absences (i.e. more than 4).
          </p>
        </div>
      ) : (
        <p className="text-xs text-app-fg-muted">
          Attendance does not affect base salary for this role.
        </p>
      )}

      <ModalFetcherInlineError message={surface.errorMatchingIntent('saveAttendanceBands')} />
      <div>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={fetcher.state === 'submitting'}
          loadingText="Saving…"
        >
          Save attendance deduction
        </Button>
      </div>
    </fetcher.Form>
  );
}
