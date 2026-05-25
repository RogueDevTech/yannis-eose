import { useMemo, useState } from 'react';
import { useNavigation, useSearchParams } from '@remix-run/react';
import { usePersistedFilters } from '~/hooks/usePersistedFilters';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { FormField } from '~/components/ui/form-field';
import { Spinner } from '~/components/ui/spinner';
import { Tabs } from '~/components/ui/tabs';
import { FinanceCashRemittanceSection, FinancePayrollSection, FinanceDisbursementSection } from './finance-overview-pulse';
import type { FinanceOverviewLoaderData } from './types';

type FinanceTab = 'remittance' | 'disbursements' | 'payroll';

export function FinancePage({ data }: { data: FinanceOverviewLoaderData }) {
  const { pulse, filters, branches = [], fundingSummary, byProduct = [], byLocation = [] } = data;
  usePersistedFilters('finance-overview');
  const [searchParams, setSearchParams] = useSearchParams();
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Finance"
        mobileInlineActions
        description="Cash remittance, disbursements, and payroll."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Finance tools"
            sheetSubtitle={<span>Date range</span>}
            triggerAriaLabel="Finance toolbar and date range"
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    startTime={filters.startTime ?? ''}
                    endTime={filters.endTime ?? ''}
                    periodAllTime={filters.periodAllTime ?? false} chrome="pill" />
              </>
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

      {branches.length > 0 && (
        <div className="card !p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField
            label={
              <span className="inline-flex items-center gap-2">
                Branch
                {branchSwitching && (
                  <span className="inline-flex items-center gap-1 text-xs font-normal text-app-fg-muted">
                    <Spinner size="sm" />
                    Loading…
                  </span>
                )}
              </span>
            }
            htmlFor="finance-overview-branch"
          >
            <SearchableSelect
              id="finance-overview-branch"
              value={filters.branchId ?? ''}
              onChange={(v) => setFilter('branchId', v)}
              options={branchOptions}
              placeholder="All branches"
              searchPlaceholder="Search branches..."
              disabled={branchSwitching}
            />
          </FormField>
          {filters.branchId && (
            <p className="sm:col-span-2 text-xs text-app-fg-muted">
              Branch filter applied.{' '}
              <button
                type="button"
                className="text-brand-600 dark:text-brand-400 hover:underline"
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete('branchId');
                  setSearchParams(next, { preventScrollReset: true });
                }}
              >
                Clear
              </button>
            </p>
          )}
        </div>
      )}

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
