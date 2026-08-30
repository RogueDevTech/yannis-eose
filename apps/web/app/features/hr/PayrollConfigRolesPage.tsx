import { useMemo, useState } from 'react';
import { Link } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { FormSelect } from '~/components/ui/form-select';
import { EmptyState } from '~/components/ui/empty-state';
import {
  CompactTable,
  CompactTableActionButton,
  CompactTableActions,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { formatRoleLabel } from '~/components/ui/role-badge';
import type { PayRole } from './payroll-prd-types';

interface PayrollConfigRolesPageProps {
  roles: PayRole[];
  canWrite: boolean;
  /** Tab bar + sub-tab content rendered between header and filters. */
  tabsSlot?: React.ReactNode;
  /** When true, hides the roles-specific content (filters + table). Used when another tab is active. */
  hideRolesContent?: boolean;
  /** Extra action button rendered in the header for the active tab. */
  headerAction?: React.ReactNode;
}

const FORMULA_FILTER_OPTIONS = [
  { value: '', label: 'All formula status' },
  { value: 'linked', label: 'Formula linked' },
  { value: 'none', label: 'No formula' },
];

function formatCategory(category: string): string {
  return formatRoleLabel(category);
}

export function PayrollConfigRolesPage({ roles, canWrite, tabsSlot, hideRolesContent, headerAction }: PayrollConfigRolesPageProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [formulaFilter, setFormulaFilter] = useState('');

  const categoryOptions = [
    { value: '', label: 'All categories' },
    { value: 'CS', label: 'CS' },
    { value: 'MEDIA_BUYING', label: 'Media Buying' },
    { value: 'LOGISTICS', label: 'Logistics' },
    { value: 'LEADERSHIP', label: 'Leadership' },
    { value: 'OPERATIONS', label: 'Operations' },
    { value: 'FINANCE', label: 'Finance' },
    { value: 'HR_ADMIN', label: 'HR / Admin' },
    { value: 'SUPPORT', label: 'Support' },
    { value: 'CONTRACTOR', label: 'Contractor' },
  ];

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
              null,
              row.commissionPlanId ? 'Formula linked' : 'No formula',
            ]
              .filter(Boolean)
              .join(' \u00b7 ')}
          </span>
        ),
      },
      {
        key: 'staffCount',
        header: 'Staff',
        align: 'right',
        render: (row) => (
          <span className={`text-sm tabular-nums ${(row.staffCount ?? 0) > 0 ? 'font-medium text-app-fg' : 'text-app-fg-muted'}`}>
            {row.staffCount ?? 0}
            {(row.contractorCount ?? 0) > 0 ? (
              <span className="ml-1 text-2xs font-normal text-app-fg-muted">
                ({row.contractorCount} contract)
              </span>
            ) : null}
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
          <CompactTableActions>
            {canWrite && (
              <CompactTableActionButton
                to={`/hr/payroll/config/rules/new?duplicateFrom=${row.id}`}
                tone="brand"
                title={`Duplicate ${row.name}`}
              >
                Duplicate
              </CompactTableActionButton>
            )}
            <CompactTableActionButton to={`/hr/payroll/config/rules/${row.id}`} tone="brand">
              View
            </CompactTableActionButton>
          </CompactTableActions>
        ),
      },
    ],
    [canWrite],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payroll config"
        mobileInlineActions
        description="Pay roles, product bonus tiers, and tax band settings."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Pay roles toolbar"
            filtersBadgeCount={[categoryFilter, formulaFilter].filter(Boolean).length}
            onClearFilters={
              categoryFilter || formulaFilter
                ? () => {
                    setCategoryFilter('');
                    setFormulaFilter('');
                  }
                : undefined
            }
            desktopActions
            desktopActionsLabel="Actions"
            desktop={
              <div className="flex items-center gap-2">
                <PageRefreshButton />
              </div>
            }
            filters={
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
            sheet={({ closeSheet }) => (
              <>
                {headerAction ? <div className="w-full [&>*]:w-full">{headerAction}</div> : null}
                {!hideRolesContent && canWrite ? (
                  <Link
                    to="/hr/payroll/config/rules/new"
                    onClick={closeSheet}
                    className="btn-secondary h-12 w-full flex items-center justify-center text-sm font-medium rounded-lg"
                  >
                    Pay Role
                  </Link>
                ) : null}
              </>
            )}
          />
        }
      />

      <MobileDateFilterRow
        hideDate
        actionsSheetTitle="Payroll config"
        actionsSheet={
          <>
            <FormSelect
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              options={categoryOptions}
            />
            <FormSelect
              value={formulaFilter}
              onChange={(e) => setFormulaFilter(e.target.value)}
              options={FORMULA_FILTER_OPTIONS}
            />
            {canWrite && (
              <Link
                to="/hr/payroll/config/rules/new"
                className="btn-secondary h-12 w-full flex items-center justify-center text-sm font-medium rounded-lg"
              >
                + Pay Role
              </Link>
            )}
          </>
        }
      />

      {tabsSlot}

      {!hideRolesContent && <>
      <div className="list-panel">
      <ToolbarFiltersCollapsible
        className="!border-0"
        hideMobileSheet
        badgeCount={[categoryFilter, formulaFilter].filter(Boolean).length}
        searchRow={
          <PageSearchControl
            value={search}
            onApply={setSearch}
            placeholder="Search pay roles"
            title="Search pay roles"
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
      />
      </div>

      {filteredRoles.length === 0 ? (
        <EmptyState
          title={search || categoryFilter || formulaFilter ? 'No matching pay roles' : 'No pay roles for this company'}
          description={
            search || categoryFilter || formulaFilter
              ? 'Try adjusting your filters.'
              : canWrite
                ? 'Select a company in the header, then create a pay role or run payroll config seed for that company.'
                : 'Pay roles are company-specific. Select a company in the header, or contact your administrator.'
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
          renderMobileCard={(row) => (
            <Link
              to={`/hr/payroll/config/rules/${row.id}`}
              prefetch="intent"
              className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-app-fg leading-snug truncate">{row.name}</p>
                <span className="shrink-0 rounded-full border border-app-border px-2 py-0.5 text-2xs font-medium text-app-fg-muted whitespace-nowrap">
                  {formatCategory(row.category)}
                </span>
              </div>
              <p className="text-xs text-app-fg-muted">
                {row.commissionPlanId ? 'Formula linked' : 'No formula'}
                {' · '}
                <span className={`tabular-nums ${(row.staffCount ?? 0) > 0 ? 'font-medium text-app-fg' : ''}`}>
                  {row.staffCount ?? 0}
                </span>
                {' staff'}
              </p>
            </Link>
          )}
        />
      )}
      </>}
    </div>
  );
}
