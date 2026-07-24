import { useMemo } from 'react';
import { Link } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { EmptyState } from '~/components/ui/empty-state';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import type { PayRole } from './payroll-prd-types';

interface PayrollConfigRolesPageProps {
  roles: PayRole[];
}

function formatCategory(category: string): string {
  return category.replace(/_/g, ' ');
}

export function PayrollConfigRolesPage({ roles }: PayrollConfigRolesPageProps) {
  const columns: CompactTableColumn<PayRole>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Pay role',
        hideable: false,
        render: (row) => <span className="font-medium text-app-fg">{row.name}</span>,
      },
      {
        key: 'category',
        header: 'Category',
        render: (row) => (
          <span className="rounded-full border border-app-border px-2 py-0.5 text-2xs font-medium text-app-fg-muted whitespace-nowrap">
            {formatCategory(row.category)}
          </span>
        ),
      },
      {
        key: 'flags',
        header: 'Flags',
        render: (row) => (
          <span className="text-xs text-app-fg-muted">
            {[
              row.reportsToRequired ? 'Reports-to required' : null,
              row.perProductBonus ? 'Per-product bonus' : null,
              row.commissionPlanId ? 'Formula linked' : 'No formula',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        mobileLabel: 'Actions',
        align: 'right',
        tight: true,
        hideable: false,
        render: (row) => (
          <CompactTableActionButton to={`/hr/payroll/config/rules/${row.id}`} tone="brand">
            Rules
          </CompactTableActionButton>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pay roles"
        mobileInlineActions
        description="Library of payroll pay roles and their linked formula plans."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Pay roles toolbar"
            desktop={<PageRefreshButton />}
          />
        }
      />

      <p className="text-xs text-app-fg-muted">
        Related:{' '}
        <Link to="/hr/payroll/config/products" className="text-brand-600 dark:text-brand-400 hover:underline">
          Product tiers
        </Link>
        ,{' '}
        <Link to="/hr/plans" className="text-brand-600 dark:text-brand-400 hover:underline">
          Commission plans
        </Link>
      </p>

      {roles.length === 0 ? (
        <EmptyState
          title="No pay roles configured"
          description="Pay roles are seeded during payroll setup. Contact your administrator if this list is empty."
        />
      ) : (
        <CompactTable<PayRole>
          columnVisibilityKey="hr.payroll.config.roles"
          columns={columns}
          rows={roles}
          rowKey={(r) => r.id}
          emptyTitle="No pay roles"
          emptyDescription=""
        />
      )}
    </div>
  );
}
