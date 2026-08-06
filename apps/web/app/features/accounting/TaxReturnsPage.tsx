import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { DateTimeText } from '~/components/ui/date-time-text';

export interface VatTransaction {
  id: string;
  postingDate: string;
  createdAt?: string | null;
  voucherType: string;
  voucherId: string;
  debit: number;
  credit: number;
  remarks: string | null;
}

export interface TaxReturnsPageProps {
  outputVat: number;
  inputVat: number;
  netVatPayable: number;
  periodStart: string;
  periodEnd: string;
  transactionCount: number;
  transactions: VatTransaction[];
  filters: { startDate: string; endDate: string };
}

const VOUCHER_LABELS: Record<string, string> = {
  JOURNAL_ENTRY: 'Journal Entry',
  SALES_INVOICE: 'Sales Invoice',
  PAYMENT: 'Payment',
  PURCHASE_RECEIPT: 'Purchase Receipt',
  PAYROLL: 'Payroll',
  EXPENSE: 'Expense',
};

export function TaxReturnsPage({
  outputVat,
  inputVat,
  netVatPayable,
  transactionCount,
  transactions,
  filters,
}: TaxReturnsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  const onMonthChange = (value: string) => {
    if (!value) return;
    const [year, month] = value.split('-');
    const startDate = `${year}-${month}-01`;
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
    const next = new URLSearchParams(searchParams);
    next.set('startDate', startDate);
    next.set('endDate', endDate);
    setSearchParams(next);
  };

  const monthValue = filters.startDate ? filters.startDate.slice(0, 7) : '';

  const handleExport = () => {
    const header = 'Date,Voucher Type,Voucher ID,Debit (Input VAT),Credit (Output VAT),Remarks';
    const csv = transactions.map((t) =>
      [
        t.postingDate,
        VOUCHER_LABELS[t.voucherType] ?? t.voucherType,
        t.voucherId,
        t.debit.toFixed(2),
        t.credit.toFixed(2),
        `"${(t.remarks ?? '').replace(/"/g, '""')}"`,
      ].join(','),
    );
    const summary = [
      '',
      `Output VAT (collected),${outputVat.toFixed(2)}`,
      `Input VAT (paid),${inputVat.toFixed(2)}`,
      `Net VAT Payable,${netVatPayable.toFixed(2)}`,
    ].join('\n');
    const blob = new Blob([header + '\n' + csv.join('\n') + '\n' + summary], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vat-return-${filters.startDate || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const monthInput = (inputId: string) => (
    <div className="flex items-center gap-2">
      <label htmlFor={inputId} className="text-sm text-app-fg-muted">Period</label>
      <input
        id={inputId}
        type="month"
        value={monthValue}
        onChange={(e) => onMonthChange(e.target.value)}
        className="h-10 md:h-9 w-full rounded-md border border-app-border bg-app-bg px-3 text-sm text-app-fg"
      />
    </div>
  );

  const exportButton =
    transactionCount > 0 ? (
      <Button variant="primary" size="sm" onClick={handleExport}>
        Export CSV (FIRS)
      </Button>
    ) : null;

  const columns: CompactTableColumn<VatTransaction>[] = [
    {
      key: 'postingDate',
      header: 'Date',
      render: (r) => <DateTimeText at={r.createdAt} dateOnly={r.postingDate} className="text-sm" />,
    },
    {
      key: 'voucherType',
      header: 'Type',
      render: (r) => (
        <span className="text-sm font-medium text-app-fg">
          {VOUCHER_LABELS[r.voucherType] ?? r.voucherType}
        </span>
      ),
    },
    {
      key: 'debit',
      header: 'Input VAT',
      align: 'right',
      render: (r) => <NairaPrice amount={r.debit} zeroAsDash className="tabular-nums" />,
    },
    {
      key: 'credit',
      header: 'Output VAT',
      align: 'right',
      render: (r) => <NairaPrice amount={r.credit} zeroAsDash className="tabular-nums" />,
    },
    {
      key: 'remarks',
      header: 'Remarks',
      render: (r) => (
        <span className="text-xs text-app-fg-muted line-clamp-1">{r.remarks ?? '-'}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tax Returns (VAT)"
        description="VAT summary for FIRS filing. Select a month to view output and input VAT."
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Tax returns toolbar"
            filters={monthInput('vat-month-mobile')}
            desktopActions
            desktopActionsLabel="Actions"
            desktop={
              <>
                <PageRefreshButton />
              </>
            }
            sheet={
              exportButton ? (
                <Button variant="secondary" size="sm" className="h-12 w-full justify-center" onClick={handleExport}>
                  Export CSV (FIRS)
                </Button>
              ) : null
            }
          />
        }
      />

      <MobileDateFilterRow
        hideDate
        actionsSheet={
          transactionCount > 0 ? (
            <Button variant="secondary" size="sm" className="h-12 w-full justify-center" onClick={handleExport}>
              Export CSV (FIRS)
            </Button>
          ) : undefined
        }
        actionsSheetTitle="Actions"
      />

      <div className="hidden md:flex items-center gap-2">
        {monthInput('vat-month')}
      </div>

      <OverviewStatStrip
        items={[
          { label: 'VAT Output', value: <NairaPrice amount={outputVat} /> },
          { label: 'VAT Input', value: <NairaPrice amount={inputVat} /> },
          {
            label: 'Net Payable',
            value: (
              <span className={netVatPayable > 0 ? 'text-danger-600' : 'text-success-600'}>
                <NairaPrice amount={netVatPayable} />
              </span>
            ),
          },
          { label: 'Transactions', value: String(transactionCount) },
        ]}
      />

      {transactions.length === 0 ? (
        <EmptyState
          title="No VAT transactions"
          description="Select a period to view VAT transactions from the general ledger."
        />
      ) : (
        <>
          <CompactTable
            columns={columns}
            rows={transactions}
            rowKey={(r) => r.id}
            renderMobileCard={(r) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-app-fg">{VOUCHER_LABELS[r.voucherType] ?? r.voucherType}</span>
                  <DateTimeText at={r.createdAt} dateOnly={r.postingDate} className="text-xs" />
                </div>
                <div className="flex items-center justify-between gap-4 text-xs text-app-fg-muted">
                  <span>Input <NairaPrice amount={r.debit} zeroAsDash className="ml-1 text-app-fg" /></span>
                  <span>Output <NairaPrice amount={r.credit} zeroAsDash className="ml-1 text-app-fg" /></span>
                </div>
              </div>
            )}
          />

          <div className="mt-4 rounded-lg border border-app-border bg-app-bg-subtle p-4">
            <h3 className="mb-3 text-sm font-semibold text-app-fg">VAT Return Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-app-fg-muted">Output VAT (collected on sales)</span>
                <NairaPrice amount={outputVat} className="font-medium" />
              </div>
              <div className="flex justify-between">
                <span className="text-app-fg-muted">Input VAT (paid on purchases)</span>
                <NairaPrice amount={inputVat} className="font-medium" />
              </div>
              <div className="flex justify-between border-t border-app-border pt-2 font-semibold">
                <span>Net VAT Payable to FIRS</span>
                <span className={netVatPayable > 0 ? 'text-danger-600' : 'text-success-600'}>
                  <NairaPrice amount={netVatPayable} />
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
