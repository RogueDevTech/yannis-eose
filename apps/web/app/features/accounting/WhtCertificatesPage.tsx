import { useState } from 'react';
import { useSearchParams, useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { AmountInput } from '~/components/ui/amount-input';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { StatusBadge } from '~/components/ui/status-badge';
import { Modal } from '~/components/ui/modal';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
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
  const [generateTarget, setGenerateTarget] = useState<WhtDeductionRow | null>(null);
  const recordFetcher = useFetcher();
  const certFetcher = useFetcher();

  useCloseOnFetcherSuccess(recordFetcher, () => setShowModal(false));

  const onPageChange = (page: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(page));
    setSearchParams(next);
  };

  const totalGross = records.reduce((s, r) => s + Number(r.grossAmount), 0);
  const totalWht = records.reduce((s, r) => s + Number(r.whtAmount), 0);
  const totalNet = records.reduce((s, r) => s + Number(r.netAmount), 0);

  const recordWhtButton = (
    <Button variant="primary" size="sm" onClick={() => setShowModal(true)}>
      Record WHT
    </Button>
  );

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
          <CompactTableActionButton tone="brand" onClick={() => setGenerateTarget(r)}>
            Generate
          </CompactTableActionButton>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="WHT Certificates"
        description="Record withholding tax deductions and generate FIRS certificates."
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="WHT certificates toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  chrome="pill"
                />
                {recordWhtButton}
              </>
            }
            sheet={({ closeSheet }) => (
              <Button
                variant="secondary"
                size="sm"
                className="h-12 w-full justify-center"
                onClick={() => {
                  closeSheet();
                  setShowModal(true);
                }}
              >
                Record WHT
              </Button>
            )}
          />
        }
      />

      <MobileDateFilterRow startDate={filters.startDate} endDate={filters.endDate} />

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
          <CompactTable
            columns={columns}
            rows={records}
            rowKey={(r) => r.id}
            renderMobileCard={(r) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-app-fg truncate">{r.vendorName}</span>
                  {r.certificateGenerated ? (
                    <StatusBadge status="Generated" variant="success" />
                  ) : (
                    <span className="text-xs text-app-fg-muted">Pending</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-4 text-xs text-app-fg-muted">
                  <span>{r.paymentDate}</span>
                  <span>Gross <NairaPrice amount={Number(r.grossAmount)} className="ml-1 text-app-fg" /></span>
                  <span>WHT <NairaPrice amount={Number(r.whtAmount)} className="ml-1 text-app-fg" /></span>
                </div>
              </div>
            )}
          />
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            onPageChange={onPageChange}
          />
        </>
      )}

      <ConfirmActionModal
        open={!!generateTarget}
        onClose={() => setGenerateTarget(null)}
        title="Generate WHT certificate"
        description={
          generateTarget
            ? `Generate a FIRS withholding tax certificate for ${generateTarget.vendorName}?`
            : ''
        }
        details={
          generateTarget ? (
            <ul className="list-disc pl-4 space-y-1 text-sm">
              <li>
                WHT <NairaPrice amount={Number(generateTarget.whtAmount)} /> of{' '}
                <NairaPrice amount={Number(generateTarget.grossAmount)} /> gross
              </li>
              <li>Payment date {generateTarget.paymentDate}</li>
            </ul>
          ) : null
        }
        confirmLabel="Generate"
        variant="warning"
        loading={certFetcher.state !== 'idle'}
        onConfirm={() => {
          if (!generateTarget) return;
          certFetcher.submit(
            { intent: 'generateCertificate', deductionId: generateTarget.id },
            { method: 'post' },
          );
          setGenerateTarget(null);
        }}
      />

      <Modal open={showModal} onClose={() => setShowModal(false)}>
        <div className="p-4 md:p-6">
          <h2 className="mb-4 text-lg font-semibold text-app-fg">Record WHT Deduction</h2>
          <recordFetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="recordWht" />
            <TextInput
              id="vendorName"
              name="vendorName"
              label="Vendor Name"
              required
            />
            <div>
              <label htmlFor="grossAmount" className="block text-sm font-medium text-app-fg mb-1">
                Gross Amount
              </label>
              <AmountInput
                id="grossAmount"
                name="grossAmount"
                required
                prefix="₦"
              />
            </div>
            <TextInput
              id="whtRate"
              name="whtRate"
              label="WHT Rate (%)"
              type="number"
              step="0.01"
              defaultValue="5"
              required
            />
            <TextInput
              id="paymentDate"
              name="paymentDate"
              label="Payment Date"
              type="date"
              required
            />
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-app-fg mb-1">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                rows={2}
                className="block w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-fg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:[color-scheme:dark]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={recordFetcher.state !== 'idle'}
                loadingText="Saving..."
              >
                Record
              </Button>
            </div>
          </recordFetcher.Form>
        </div>
      </Modal>
    </div>
  );
}
