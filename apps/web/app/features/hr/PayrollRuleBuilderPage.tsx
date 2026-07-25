import { useCallback, useMemo, useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { useFetcherToast } from '~/components/ui/toast';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import type { CommissionPlan } from './types';
import type { PayRole } from './payroll-prd-types';
import {
  PayrollFormulaTierBuilder,
  type FormulaPreviewResult,
} from './PayrollFormulaTierBuilder';
import type { PayrollFormula } from '@yannis/shared';

interface PayrollRuleBuilderPageProps {
  payRole: PayRole;
  plan: CommissionPlan | null;
  canWrite: boolean;
}

export function PayrollRuleBuilderPage({ payRole, plan, canWrite }: PayrollRuleBuilderPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const archiveFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const previewFetcher = useFetcher<{ preview?: FormulaPreviewResult; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const initialRules = (plan?.rules ?? {}) as PayrollFormula;
  const [showArchive, setShowArchive] = useState(false);

  useFetcherToast(fetcher.data, { successMessage: 'Formula saved' });

  useCloseOnFetcherSuccess(fetcher, () => undefined, {
    intent: plan ? 'saveFormulaConfig' : 'saveFormulaConfig',
  });

  const effectiveLabel = useMemo(() => {
    if (!plan) return 'No linked commission plan yet';
    const from = new Date(plan.effectiveFrom).toLocaleDateString('en-NG', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const to = plan.effectiveTo
      ? new Date(plan.effectiveTo).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Ongoing';
    return `${plan.planName} · Effective ${from}: ${to}`;
  }, [plan]);

  const handlePreview = useCallback(
    (formula: PayrollFormula, sampleDr: number, sampleTeamDr: number) => {
      previewFetcher.submit(
        {
          intent: 'previewFormula',
          formulaJson: JSON.stringify(formula),
          sampleDr: String(sampleDr),
          sampleTeamDr: String(sampleTeamDr),
        },
        { method: 'post' },
      );
    },
    [previewFetcher],
  );

  const previewResult =
    previewFetcher.data && 'preview' in previewFetcher.data ? previewFetcher.data.preview ?? null : null;

  return (
    <div className="space-y-3">
      <PageHeader
        title={`Formula: ${payRole.name}`}
        backTo="/hr/payroll/config/roles"
        mobileInlineActions
        description={`${payRole.category.replace(/_/g, ' ')} \u00b7 ${effectiveLabel}`}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Formula builder toolbar"
            desktop={<PageRefreshButton />}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-app-fg-muted">
        <FlagRow
          label="Reports-to required"
          active={payRole.reportsToRequired}
          hint="Staff assigned this role must have a manager set. Used for roles where bonus formulas factor in team performance."
        />
        <FlagRow
          label="Per-product bonus"
          active={payRole.perProductBonus}
          hint="Bonus tiers are evaluated per product instead of total deliveries. e.g. 10 deliveries of Product A and 5 of Product B are calculated separately."
        />
      </div>

      <ModalFetcherInlineError message={surface.errorMatchingIntent('saveFormulaConfig')} />

      <fetcher.Form method="post" className="space-y-3">
        <input type="hidden" name="intent" value="saveFormulaConfig" />
        <input type="hidden" name="payRoleId" value={payRole.id} />
        <input type="hidden" name="planName" value={plan?.planName ?? `${payRole.name} Formula`} />
        <input type="hidden" name="effectiveFrom" value={new Date().toISOString().slice(0, 10)} />

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
              Save formula (new version)
            </Button>
            <div className="flex-1" />
            <Button variant="danger" size="sm" onClick={() => setShowArchive(true)}>
              Archive pay role
            </Button>
          </div>
        ) : null}
      </fetcher.Form>

      {showArchive && (
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

function FlagRow({ label, active, hint }: { label: string; active: boolean; hint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className={active ? 'text-success-600 dark:text-success-400' : 'text-app-fg-muted'}>
          {active ? '\u2713' : '\u2717'} {label}
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-app-fg-muted hover:text-app-fg shrink-0"
          aria-label={`Info about ${label}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>
      {open && (
        <Modal open onClose={() => setOpen(false)} maxWidth="max-w-sm" contentClassName="p-5 space-y-3">
          <h4 className="text-base font-semibold text-app-fg">{label}</h4>
          <p className="text-sm text-app-fg-muted">{hint}</p>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Close</Button>
        </Modal>
      )}
    </>
  );
}
