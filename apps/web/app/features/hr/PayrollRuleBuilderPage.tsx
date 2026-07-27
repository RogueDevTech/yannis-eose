import { useCallback, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
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
  { value: 'TPL_RIDER', label: 'TPL Rider' },
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
  const archiveFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const previewFetcher = useFetcher<{ preview?: FormulaPreviewResult; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const initialRules = (plan?.rules ?? {}) as PayrollFormula;
  const [showArchive, setShowArchive] = useState(false);

  // Role metadata state
  const [reportsToRequired, setReportsToRequired] = useState(payRole?.reportsToRequired ?? false);
  const [perProductBonus, setPerProductBonus] = useState(payRole?.perProductBonus ?? false);
  const [category, setCategory] = useState(payRole?.category ?? '');
  const showPerProductBonus = category === 'CS';

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

  return (
    <div className="space-y-3">
      <PageHeader
        title={isCreate ? 'Create pay role' : payRole.name}
        backTo="/hr/payroll/config/roles"
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

      <ModalFetcherInlineError message={surface.errorMatchingIntent(intent)} />

      <fetcher.Form method="post" className="space-y-5">
        <input type="hidden" name="intent" value={intent} />
        {payRole && <input type="hidden" name="payRoleId" value={payRole.id} />}
        <input type="hidden" name="planName" value={plan?.planName ?? (payRole ? `${payRole.name} Formula` : 'Formula')} />
        <input type="hidden" name="effectiveFrom" value={new Date().toISOString().slice(0, 10)} />
        <input type="hidden" name="reportsToRequired" value={String(reportsToRequired)} />
        <input type="hidden" name="perProductBonus" value={String(perProductBonus)} />

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
            </div>
            {showPerProductBonus && (
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={perProductBonus}
                  onChange={(e) => setPerProductBonus(e.target.checked)}
                  className="mt-0.5 rounded border-app-border text-brand-600 focus:ring-brand-500"
                />
                <div>
                  <span className="text-sm text-app-fg">Per-product bonus</span>
                  <p className="text-xs text-app-fg-muted mt-0.5">
                    Bonus tiers evaluated per product instead of total deliveries.
                  </p>
                </div>
              </label>
            )}
          </div>
        ) : (
          <div className="card p-4 space-y-2">
            <h3 className="text-sm font-semibold text-app-fg">{payRole?.name}</h3>
            {showPerProductBonus && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-app-fg-muted">
                <span className={perProductBonus ? 'text-success-600 dark:text-success-400' : ''}>
                  {perProductBonus ? '\u2713' : '\u2717'} Per-product bonus
                </span>
              </div>
            )}
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
            {!isCreate && (
              <>
                <div className="flex-1" />
                <Button variant="danger" size="sm" onClick={() => setShowArchive(true)}>
                  Archive pay role
                </Button>
              </>
            )}
          </div>
        ) : null}
      </fetcher.Form>

      {showArchive && payRole && (
        <ConfirmActionModal
          open
          title="Archive pay role"
          description={`Archive "${payRole.name}"? Staff currently assigned this role will keep their existing payouts, but no new batches will use it.`}
          confirmLabel="Archive"
          variant="danger"
          loading={archiveFetcher.state === 'submitting'}
          onClose={() => setShowArchive(false)}
          onConfirm={() => {
            archiveFetcher.submit(
              { intent: 'archivePayRole', payRoleId: payRole.id },
              { method: 'post' },
            );
          }}
        />
      )}
    </div>
  );
}
