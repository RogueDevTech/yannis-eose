import { useMemo, useState } from 'react';
import { useNavigation, useSearchParams } from '@remix-run/react';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { FilterDismiss } from '~/components/ui/filter-dismiss';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { Tabs } from '~/components/ui/tabs';
import { FinanceCashRemittanceSection, FinancePayrollSection, FinanceDisbursementSection } from './finance-overview-pulse';
import type { FinanceOverviewLoaderData } from './types';

type FinanceTab = 'remittance' | 'disbursements' | 'payroll';

export function FinancePage({ data }: { data: FinanceOverviewLoaderData }) {
  const { pulse, filters, branches = [], fundingSummary, byProduct = [], byLocation = [] } = data;
  const [, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState<FinanceTab>('remittance');

  // Only show the inline spinner when the branchId search param is actually
  // changing (not for unrelated navigations like date-filter or tab clicks).
  const nextBranchId = navigation.location
    ? new URLSearchParams(navigation.location.search).get('branchId') ?? ''
    : null;
  const branchSwitching =
    navigation.state === 'loading' &&
    nextBranchId !== null &&
    nextBranchId !== (filters.branchId ?? '');

  const setFilter = (key: 'branchId', value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!value) next.delete(key);
        else next.set(key, value);
        next.delete('page');
        return next;
      },
      { preventScrollReset: true },
    );
  };

  const branchOptions = useMemo(
    () => [
      { value: '', label: 'All branches' },
      ...branches.map((b) => ({ value: b.id, label: b.name })),
    ],
    [branches],
  );

  const filtersBadgeCount = (filters.branchId ? 1 : 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Finance"
        mobileInlineActions
        description="Cash remittance, disbursements, and payroll."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Finance toolbar and filters"
            saveFilterKey
            filtersBadgeCount={filtersBadgeCount}
            desktop={
              <>
                <PageRefreshButton />
                {branches.length > 0 && (
                  <div className="relative">
                    {filters.branchId && (
                      <FilterDismiss onClear={() => setFilter('branchId', '')} />
                    )}
                    <SearchableSelect
                      id="finance-overview-branch"
                      value={filters.branchId ?? ''}
                      onChange={(v) => setFilter('branchId', v)}
                      options={branchOptions}
                      placeholder="All branches"
                      searchPlaceholder="Search branches..."
                      disabled={branchSwitching}
                    />
                  </div>
                )}
                <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    startTime={filters.startTime ?? ''}
                    endTime={filters.endTime ?? ''}
                    periodAllTime={filters.periodAllTime ?? false} chrome="pill" />
              </>
            }
            filters={
              branches.length > 0 ? (
                <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                  {filters.branchId && (
                    <FilterDismiss onClear={() => setFilter('branchId', '')} />
                  )}
                  <SearchableSelect
                    id="finance-overview-branch-mobile"
                    value={filters.branchId ?? ''}
                    onChange={(v) => setFilter('branchId', v)}
                    options={branchOptions}
                    placeholder="All branches"
                    searchPlaceholder="Search branches..."
                    disabled={branchSwitching}
                    triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
                    wrapperClassName="w-full"
                  />
                </div>
              ) : undefined
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        startTime={filters.startTime ?? ''}
        endTime={filters.endTime ?? ''}
        periodAllTime={filters.periodAllTime ?? false}
      />

      <Tabs
        variant="underline"
        value={activeTab}
        onChange={(v) => setActiveTab(v as FinanceTab)}
        tabs={[
          { value: 'remittance', label: 'Cash remittance' },
          { value: 'disbursements', label: 'Disbursements' },
          { value: 'payroll', label: 'Payroll' },
        ]}
      />

      {activeTab === 'remittance' && (
        <FinanceCashRemittanceSection pulse={pulse} byProduct={byProduct} byLocation={byLocation} />
      )}

      {activeTab === 'disbursements' && fundingSummary && (
        <FinanceDisbursementSection summary={fundingSummary} />
      )}

      {activeTab === 'payroll' && (
        <FinancePayrollSection pulse={pulse} />
      )}
    </div>
  );
}
