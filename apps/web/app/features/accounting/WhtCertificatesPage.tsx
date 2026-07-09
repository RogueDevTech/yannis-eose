import { useState } from 'react';
import { useSearchParams, useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { DateInput } from '~/components/ui/date-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { StatusBadge } from '~/components/ui/status-badge';
import { Modal } from '~/components/ui/modal';
import { Pagination } from '~/components/ui/pagination';

export interface WhtDeductionRow {
  id: string;
  vendorName: string;
  paymentDate: string;
  grossAmount: string;
  whtRate: string;
  whtAmount: string;
  netAmount: string;
  description: string | null;
  certificateGenerated: boolean;
}

export interface WhtCertificatesPageProps {
  records: WhtDeductionRow[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
  filters: { startDate: string; endDate: string };
}

export function WhtCertificatesPage({ records, pagination, filters }: WhtCertificatesPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showModal, setShowModal] = useState(false);
  const recordFetcher = useFetcher();
  const certFetcher = useFetcher();

  const onDateChange = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.set('page', '1');
    setSearchParams(next);
  };

  const onPageChange = (page: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(page));
    setSearchParams(next);
  };

  const totalGross = records.reduce((s, r) => s + Number(r.grossAmount), 0);
  const totalWht = records.reduce((s, r) => s + Number(r.whtAmount), 0);
  const totalNet = records.reduce((s, r) => s + Number(r.netAmount), 0);

  const columns: CompactTableColumn<WhtDeductionRow>[] = [
    {
      key: 'vendorName',
      header: 'Vendor',
      render: (r) => <span className="font-medium text-app-fg">{r.vendorName}</span>,
    },
    {
      key: 'paymentDate',
      header: 'Date',
      render: (r) => <span className="text-sm text-app-fg-muted">{r.paymentDate}</span>,
    },
    {
      key: 'grossAmount',
      header: 'Gross',
      align: 'right',
      render: (r) => <NairaPrice amount={Number(r.grossAmount)} className="tabular-nums" />,
    },
    {
      key: 'whtRate',
      header: 'WHT %',
      align: 'right',
      render: (r) => <span className="tabular-nums text-sm">{Number(r.whtRate).toFixed(1)}%</span>,
    },
    {
      key: 'whtAmount',
      header: 'WHT Amt',
      align: 'right',
      render: (r) => <NairaPrice amount={Number(r.whtAmount)} className="tabular-nums" />,
    },
    {
      key: 'netAmount',
      header: 'Net',
      align: 'right',
      render: (r) => <NairaPrice amount={Number(r.netAmount)} className="tabular-nums" />,
    },
    {
      key: 'certificateGenerated',
      header: 'Certificate',
      render: (r) =>
        r.certificateGenerated ? (
          <StatusBadge status="Generated" variant="success" />
        ) : (
          <certFetcher.Form method="post">
            <input type="hidden" name="intent" value="generateCertificate" />
            <input type="hidden" name="deductionId" value={r.id} />
            <button
              type="submit"
              className="rounded bg-app-primary px-2 py-1 text-xs font-medium text-white hover:bg-app-primary/90"
            >
              Generate
            </button>
          </certFetcher.Form>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="WHT Certificates"
        description="Record withholding tax deductions and generate FIRS certificates."
        actions={
          <button
            onClick={() => setShowModal(true)}
            className="rounded-lg bg-app-primary px-3 py-2 text-sm font-medium text-white hover:bg-app-primary/90"
          >
            Record WHT
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="wht-start" className="text-sm text-app-fg-muted">From</label>
          <DateInput
            id="wht-start"
            value={filters.startDate}
            onChange={(e) => onDateChange('startDate', e.target.value)}
            wrapperClassName="w-44"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="wht-end" className="text-sm text-app-fg-muted">To</label>
          <DateInput
            id="wht-end"
            value={filters.endDate}
            onChange={(e) => onDateChange('endDate', e.target.value)}
            wrapperClassName="w-44"
          />
        </div>
      </div>

      <OverviewStatStrip
        items={[
          { label: 'Total Gross', value: <NairaPrice amount={totalGross} /> },
          { label: 'Total WHT', value: <NairaPrice amount={totalWht} /> },
          { label: 'Total Net', value: <NairaPrice amount={totalNet} /> },
          { label: 'Records', value: String(pagination.total) },
        ]}
      />

      {records.length === 0 ? (
        <EmptyState
          title="No WHT deductions recorded"
          description="Record a withholding tax deduction to start tracking."
        />
      ) : (
        <>
          <CompactTable columns={columns} rows={records} rowKey={(r) => r.id} />
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            onPageChange={onPageChange}
          />
        </>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)}>
        <div className="p-4 md:p-6">
          <h2 className="mb-4 text-lg font-semibold text-app-fg">Record WHT Deduction</h2>
          <recordFetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="recordWht" />
            <div>
              <label htmlFor="vendorName" className="block text-sm font-medium text-app-fg">Vendor Name</label>
              <input
                id="vendorName"
                name="vendorName"
                type="text"
                required
                className="mt-1 block w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-fg"
              />
            </div>
            <div>
              <label htmlFor="grossAmount" className="block text-sm font-medium text-app-fg">Gross Amount</label>
              <input
                id="grossAmount"
                name="grossAmount"
                type="number"
                step="0.01"
                min="0.01"
                required
                className="mt-1 block w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-fg"
              />
            </div>
            <div>
              <label htmlFor="whtRate" className="block text-sm font-medium text-app-fg">WHT Rate (%)</label>
              <input
                id="whtRate"
                name="whtRate"
                type="number"
                step="0.01"
                defaultValue="5"
                required
                className="mt-1 block w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-fg"
              />
            </div>
            <div>
              <label htmlFor="paymentDate" className="block text-sm font-medium text-app-fg">Payment Date</label>
              <input
                id="paymentDate"
                name="paymentDate"
                type="date"
                required
                className="mt-1 block w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-fg"
              />
            </div>
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-app-fg">Description</label>
              <textarea
                id="description"
                name="description"
                rows={2}
                className="mt-1 block w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-fg"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-app-border px-3 py-2 text-sm text-app-fg hover:bg-app-bg-hover"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-app-primary px-4 py-2 text-sm font-medium text-white hover:bg-app-primary/90"
              >
                Record
              </button>
            </div>
          </recordFetcher.Form>
        </div>
      </Modal>
    </>
  );
}
