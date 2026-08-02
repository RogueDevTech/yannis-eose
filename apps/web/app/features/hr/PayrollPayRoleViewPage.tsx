import { useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import type { PayrollFormula } from '@yannis/shared';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { RoleBadge, formatRoleLabel } from '~/components/ui/role-badge';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import type { CommissionPlan } from './types';
import type { PayRole } from './payroll-prd-types';
import { PayrollFormulaRulesExplanation } from './PayrollFormulaRulesExplanation';

export type AssignedStaffRow = {
  id: string;
  name: string;
  role: string;
  email: string;
};

export type AssignedContractorRow = {
  id: string;
  name: string;
  jobTitle: string | null;
  monthlyFee: string;
  branchId: string | null;
};

interface PayrollPayRoleViewPageProps {
  payRole: PayRole;
  plan: CommissionPlan | null;
  assignedStaff: AssignedStaffRow[];
  assignedContractors: AssignedContractorRow[];
  canWrite: boolean;
}

export function PayrollPayRoleViewPage({
  payRole,
  plan,
  assignedStaff,
  assignedContractors,
  canWrite,
}: PayrollPayRoleViewPageProps) {
  const archiveFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [showArchive, setShowArchive] = useState(false);

  useFetcherToast(archiveFetcher.data, { successMessage: 'Pay role archived' });
  useCloseOnFetcherSuccess(archiveFetcher, () => setShowArchive(false), { intent: 'archivePayRole' });

  const formula = (plan?.rules ?? null) as PayrollFormula | null;
  const employeeCount = payRole.employeeCount ?? assignedStaff.length;
  const contractorCount = payRole.contractorCount ?? assignedContractors.length;
  const staffCount = payRole.staffCount ?? employeeCount + contractorCount;
  const assignHref = `/hr/payroll/config/roles/${payRole.id}/assign?assignStatus=assigned_this${
    contractorCount > 0 && employeeCount === 0 ? '&people=contractors' : ''
  }`;
  const effectiveLabel = (() => {
    if (!plan) return null;
    const from = new Date(plan.effectiveFrom).toLocaleDateString('en-NG', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const to = plan.effectiveTo
      ? new Date(plan.effectiveTo).toLocaleDateString('en-NG', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : 'Ongoing';
    return `${plan.planName} · Effective ${from}: ${to}`;
  })();

  const staffColumns: CompactTableColumn<AssignedStaffRow>[] = [
    {
      key: 'name',
      header: 'Staff',
      hideable: false,
      render: (row) => (
        <div className="min-w-0">
          <Link
            to={`/hr/users/${row.id}`}
            className="font-medium text-app-fg hover:underline truncate block"
          >
            {row.name}
          </Link>
          <p className="text-xs text-app-fg-muted truncate">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'System role',
      render: (row) => <RoleBadge role={row.role} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      hideable: false,
      render: (row) => (
        <CompactTableActionButton to={`/hr/users/${row.id}`} tone="brand">
          View
        </CompactTableActionButton>
      ),
    },
  ];

  const contractorColumns: CompactTableColumn<AssignedContractorRow>[] = [
    {
      key: 'name',
      header: 'Contractor',
      hideable: false,
      render: (row) => (
        <div className="min-w-0">
          <Link
            to={`/hr/payroll/contractors/${row.id}`}
            className="font-medium text-app-fg hover:underline truncate block"
          >
            {row.name}
          </Link>
          {row.jobTitle ? (
            <p className="text-xs text-app-fg-muted truncate">{row.jobTitle}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'fee',
      header: 'Monthly fee',
      nowrap: true,
      render: (row) => (
        <span className="text-sm text-app-fg tabular-nums">
          <NairaPrice amount={Number(row.monthlyFee)} />
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      hideable: false,
      render: (row) => (
        <CompactTableActionButton to={`/hr/payroll/contractors/${row.id}`} tone="brand">
          View
        </CompactTableActionButton>
      ),
    },
  ];

  const hasAnyone = assignedStaff.length > 0 || assignedContractors.length > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={payRole.name}
        backTo="/hr/payroll/config/roles"
        mobileInlineActions
        description={effectiveLabel ?? 'Pay role rules and staff assignment.'}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Pay role toolbar"
            desktop={
              <div className="flex flex-wrap items-center gap-2">
                <PageRefreshButton />
                {canWrite && (
                  <>
                    <Link
                      to={`/hr/payroll/config/rules/${payRole.id}/edit`}
                      className="btn-primary inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg"
                    >
                      Edit formula
                    </Link>
                    <Link
                      to={assignHref}
                      className="btn-secondary inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg"
                    >
                      Assign people
                    </Link>
                    <Button variant="danger" size="sm" onClick={() => setShowArchive(true)}>
                      Archive
                    </Button>
                  </>
                )}
              </div>
            }
            sheet={({ closeSheet }) =>
              canWrite ? (
                <>
                  <Link
                    to={`/hr/payroll/config/rules/${payRole.id}/edit`}
                    onClick={closeSheet}
                    className="btn-primary h-12 w-full flex items-center justify-center text-sm font-medium rounded-lg"
                  >
                    Edit formula
                  </Link>
                  <Link
                    to={assignHref}
                    onClick={closeSheet}
                    className="btn-secondary h-12 w-full flex items-center justify-center text-sm font-medium rounded-lg"
                  >
                    Assign people
                  </Link>
                  <Button
                    variant="danger"
                    size="sm"
                    className="h-12 w-full"
                    onClick={() => {
                      closeSheet();
                      setShowArchive(true);
                    }}
                  >
                    Archive
                  </Button>
                </>
              ) : null
            }
          />
        }
      />

      <MobileDateFilterRow hideDate />

      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-app-fg">Role details</h3>
        <dl className="grid gap-2 sm:grid-cols-3 text-sm">
          <div className="flex justify-between gap-3 sm:block sm:space-y-0.5">
            <dt className="text-app-fg-muted">Category</dt>
            <dd className="text-app-fg font-medium">{formatRoleLabel(payRole.category)}</dd>
          </div>
          <div className="flex justify-between gap-3 sm:block sm:space-y-0.5">
            <dt className="text-app-fg-muted">People assigned</dt>
            <dd className="text-app-fg font-medium tabular-nums">
              {staffCount}
              {staffCount > 0 ? (
                <span className="text-app-fg-muted font-normal">
                  {' '}
                  ({employeeCount} staff · {contractorCount} contractors)
                </span>
              ) : null}
            </dd>
          </div>
          <div className="flex justify-between gap-3 sm:block sm:space-y-0.5">
            <dt className="text-app-fg-muted">Formula</dt>
            <dd className="text-app-fg font-medium">
              {payRole.commissionPlanId ? 'Linked' : 'None'}
            </dd>
          </div>
          <div className="flex justify-between gap-3 sm:block sm:space-y-0.5">
            <dt className="text-app-fg-muted">Tax</dt>
            <dd className="text-app-fg font-medium">
              {payRole.defaultTaxStatus === 'GROSS_NO_DEDUCTION'
                ? 'None (no tax)'
                : payRole.defaultTaxStatus === 'EMPLOYER_SUBSIDIZED_PAYE'
                  ? 'Employer subsidized PAYE'
                  : 'Standard PAYE'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-app-fg">
            Assigned people ({staffCount})
          </h3>
          {canWrite ? (
            <Link
              to={assignHref}
              className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
            >
              Manage assignment
            </Link>
          ) : null}
        </div>
        {!hasAnyone ? (
          <EmptyState
            title="No one on this pay role"
            description={
              canWrite
                ? 'Assign staff or contractors to this formula so payroll can use these rules.'
                : 'Nobody is assigned this pay role yet.'
            }
          />
        ) : (
          <div className="space-y-4">
            {assignedStaff.length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">
                  Staff ({assignedStaff.length})
                </h4>
                <CompactTable<AssignedStaffRow>
                  columnVisibilityKey="hr.payroll.config.rules.assigned-staff"
                  columns={staffColumns}
                  rows={assignedStaff}
                  rowKey={(r) => r.id}
                  emptyTitle="No staff"
                  emptyDescription=""
                  renderMobileCard={(row) => (
                    <Link
                      to={`/hr/users/${row.id}`}
                      prefetch="intent"
                      className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1 text-left"
                    >
                      <p className="text-sm font-semibold text-app-fg leading-snug truncate">{row.name}</p>
                      <p className="text-xs text-app-fg-muted truncate">{row.email}</p>
                      <p className="text-xs text-app-fg-muted">{formatRoleLabel(row.role)}</p>
                    </Link>
                  )}
                />
              </div>
            ) : null}

            {assignedContractors.length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">
                  Contractors ({assignedContractors.length})
                </h4>
                <CompactTable<AssignedContractorRow>
                  columnVisibilityKey="hr.payroll.config.rules.assigned-contractors"
                  columns={contractorColumns}
                  rows={assignedContractors}
                  rowKey={(r) => r.id}
                  emptyTitle="No contractors"
                  emptyDescription=""
                  renderMobileCard={(row) => (
                    <Link
                      to={`/hr/payroll/contractors/${row.id}`}
                      prefetch="intent"
                      className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1 text-left"
                    >
                      <p className="text-sm font-semibold text-app-fg leading-snug truncate">{row.name}</p>
                      {row.jobTitle ? (
                        <p className="text-xs text-app-fg-muted truncate">{row.jobTitle}</p>
                      ) : null}
                      <p className="text-xs text-app-fg-muted tabular-nums">
                        <NairaPrice amount={Number(row.monthlyFee)} /> / month
                      </p>
                    </Link>
                  )}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

      <PayrollFormulaRulesExplanation formula={formula} />

      {showArchive && (
        <ConfirmActionModal
          open
          title="Archive pay role"
          description={`Archive "${payRole.name}"? Staff and contractors currently assigned this role will keep their existing payouts, but no new batches will use it.`}
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
