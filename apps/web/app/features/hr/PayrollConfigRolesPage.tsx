import { useMemo, useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { EmptyState } from '~/components/ui/empty-state';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { formatRoleLabel } from '~/components/ui/role-badge';
import type { PayRole } from './payroll-prd-types';

interface PayrollConfigRolesPageProps {
  roles: PayRole[];
  canWrite: boolean;
}

const FORMULA_FILTER_OPTIONS = [
  { value: '', label: 'All formula status' },
  { value: 'linked', label: 'Formula linked' },
  { value: 'none', label: 'No formula' },
];

function formatCategory(category: string): string {
  return formatRoleLabel(category);
}

export function PayrollConfigRolesPage({ roles, canWrite }: PayrollConfigRolesPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [archiveRole, setArchiveRole] = useState<PayRole | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [formulaFilter, setFormulaFilter] = useState('');

  useFetcherToast(fetcher.data, { successMessage: 'Pay role archived' });
  useCloseOnFetcherSuccess(fetcher, () => setArchiveRole(null), { intent: 'archivePayRole' });

  const categoryOptions = useMemo(() => {
    const cats = [...new Set(roles.map((r) => r.category))].sort();
    return [{ value: '', label: 'All categories' }, ...cats.map((c) => ({ value: c, label: formatCategory(c) }))];
  }, [roles]);

  const filteredRoles = useMemo(() => {
    let list = roles;
    const q = search.toLowerCase().trim();
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q));
    if (categoryFilter) list = list.filter((r) => r.category === categoryFilter);
    if (formulaFilter === 'linked') list = list.filter((r) => r.commissionPlanId);
    else if (formulaFilter === 'none') list = list.filter((r) => !r.commissionPlanId);
    return list;
  }, [roles, search, categoryFilter, formulaFilter]);

  const columns: CompactTableColumn<PayRole>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Pay role',
        hideable: false,
        render: (row) => (
          <Link
            to={`/hr/payroll/config/rules/${row.id}`}
            className="font-medium text-app-fg hover:underline"
          >
            {row.name}
          </Link>
        ),
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
              .join(' \u00b7 ')}
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
          <div className="inline-flex items-center gap-1.5">
            <CompactTableActionButton to={`/hr/payroll/config/rules/${row.id}`} tone="brand">
              {canWrite ? 'Edit' : 'View'}
            </CompactTableActionButton>
            {canWrite && (
              <CompactTableActionButton to={`/hr/payroll/config/roles/${row.id}/assign`}>
                View
              </CompactTableActionButton>
            )}
            {canWrite && (
              <CompactTableActionButton onClick={() => setArchiveRole(row)} tone="danger">
                Archive
              </CompactTableActionButton>
            )}
          </div>
        ),
      },
    ],
    [canWrite],
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
            desktop={
              <div className="flex items-center gap-2">
                <PageRefreshButton />
                {canWrite && (
                  <Link
                    to="/hr/payroll/config/rules/new"
                    className="btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg"
                  >
                    + Pay Role
                  </Link>
                )}
              </div>
            }
            sheet={({ closeSheet }) =>
              canWrite ? (
                <Link
                  to="/hr/payroll/config/rules/new"
                  onClick={closeSheet}
                  className="btn-primary h-12 w-full flex items-center justify-center text-sm font-medium rounded-lg"
                >
                  + Pay Role
                </Link>
              ) : null
            }
          />
        }
      />

      <div className="list-panel">
      <ToolbarFiltersCollapsible
        className="!border-0"
        badgeCount={[categoryFilter, formulaFilter].filter(Boolean).length}
        searchRow={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search pay roles"
          />
        }
        desktopInlineFilters={
          <>
            <FormSelect
              label=""
              name="category"
              options={categoryOptions}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-44"
            />
            <FormSelect
              label=""
              name="formula"
              options={FORMULA_FILTER_OPTIONS}
              value={formulaFilter}
              onChange={(e) => setFormulaFilter(e.target.value)}
              className="w-40"
            />
          </>
        }
        sheetFilterBody={
          <div className="space-y-3">
            <FormSelect
              label="Category"
              name="category"
              options={categoryOptions}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            />
            <FormSelect
              label="Formula status"
              name="formula"
              options={FORMULA_FILTER_OPTIONS}
              value={formulaFilter}
              onChange={(e) => setFormulaFilter(e.target.value)}
            />
          </div>
        }
      />
      </div>

      <p className="text-xs text-app-fg-muted">
        Related:{' '}
        <Link to="/hr/payroll/config/products" className="text-brand-600 dark:text-brand-400 hover:underline">
          Product tiers
        </Link>
        ,{' '}
        <Link to="/hr/payroll/config/tax-bands" className="text-brand-600 dark:text-brand-400 hover:underline">
          Tax bands
        </Link>
      </p>

      {filteredRoles.length === 0 ? (
        <EmptyState
          title={search || categoryFilter || formulaFilter ? 'No matching pay roles' : 'No pay roles configured'}
          description={
            search || categoryFilter || formulaFilter
              ? 'Try adjusting your filters.'
              : canWrite ? 'Create your first pay role to get started.' : 'Pay roles are seeded during payroll setup. Contact your administrator if this list is empty.'
          }
        />
      ) : (
        <CompactTable<PayRole>
          columnVisibilityKey="hr.payroll.config.roles"
          columns={columns}
          rows={filteredRoles}
          rowKey={(r) => r.id}
          emptyTitle="No pay roles"
          emptyDescription=""
        />
      )}

      {/* Archive confirmation */}
      {archiveRole && (
        <ConfirmActionModal
          open
          title="Archive pay role"
          description={`Archive "${archiveRole.name}"? Staff currently assigned this role will keep their existing payouts, but no new batches will use it.`}
          confirmLabel="Archive"
          variant="danger"
          loading={fetcher.state === 'submitting'}
          onClose={() => setArchiveRole(null)}
          onConfirm={() => {
            fetcher.submit(
              { intent: 'archivePayRole', payRoleId: archiveRole.id },
              { method: 'post' },
            );
          }}
        />
      )}
    </div>
  );
}
