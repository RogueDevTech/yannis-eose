import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface, ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { Tabs } from '~/components/ui/tabs';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { OverviewStatStrip, type OverviewStatStripItem } from '~/components/ui/overview-stat-strip';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { Textarea } from '~/components/ui/textarea';
import { FormSelect } from '~/components/ui/form-select';
import { AmountInput } from '~/components/ui/amount-input';
import { periodLabel, shiftPeriod, periodFor, lagosToday } from './reconciliation-period';
import { downloadReconciliationPdf, downloadReconciliationXlsx, movementKindLabel, summaryLines } from './reconciliation-export';
import type {
  FundingAdjustmentRecord,
  FundingReconciliation,
  FundingReconciliationLoaderData,
  ReconciliationChangedItem,
  ReconciliationMovement,
  ReconciliationView,
} from './types';

const VIEW_TABS: { value: ReconciliationView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'custom', label: 'Custom' },
  { value: 'all', label: 'All time' },
];

const num = (v: string | number) => Number(v);
const naira = (v: string | number) =>
  `₦${num(v).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const signed = (v: string | number) => (num(v) < 0 ? `-${naira(-num(v))}` : `+${naira(v)}`);
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
const effectClass = (v: string | number) =>
  num(v) > 0 ? 'text-success-600 dark:text-success-400' : num(v) < 0 ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg-muted';
const monthName = (ym: string) =>
  new Date(`${ym}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="list-panel">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="text-sm font-semibold text-app-fg">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Banner({ tone, children }: { tone: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode }) {
  const cls = {
    info: 'border-brand-200 bg-brand-50/60 text-brand-800 dark:border-brand-800 dark:bg-brand-900/20 dark:text-brand-200',
    warning: 'border-warning-200 bg-warning-50 text-warning-800 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-200',
    danger: 'border-danger-200 bg-danger-50 text-danger-800 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-200',
    success: 'border-success-200 bg-success-50 text-success-800 dark:border-success-800 dark:bg-success-900/20 dark:text-success-200',
  }[tone];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

function ChangedItems({ items }: { items: ReconciliationChangedItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {items.slice(0, 20).map((c) => (
        <li key={`${c.kind}-${c.id}`} className="flex flex-wrap gap-x-2">
          <span className="font-mono">{c.reference}</span>
          <span>{movementKindLabel(c.kind)}</span>
          <span>{naira(c.amount)}</span>
          <span>dated {day(c.date)}</span>
          <span>now {c.status.toLowerCase()}</span>
          <span>changed {day(c.changedAt)}</span>
        </li>
      ))}
      {items.length > 20 && <li>and {items.length - 20} more</li>}
    </ul>
  );
}

export function FundingReconciliationPage({
  users,
  selectedUserId,
  view,
  startDate,
  endDate,
  compare,
  data,
  error,
  canAdjust,
  canClosePeriod,
  closes,
  adjustments,
}: FundingReconciliationLoaderData) {
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<{ success?: boolean; error?: string; intent?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [reviewAdj, setReviewAdj] = useState<{ row: FundingAdjustmentRecord; action: 'approve' | 'reject' } | null>(null);
  const [adjAmount, setAdjAmount] = useState('');
  const closable = closes?.closableMonths ?? [];
  const firstClose = (closes?.closes.length ?? 0) === 0;
  const [closeMonth, setCloseMonth] = useState(closable[0] ?? '');

  const modalOpen = showAdjust || showClose || reviewAdj != null;
  useFetcherToast(fetcher.data, { skipErrorToast: modalOpen });
  const onSuccess = useCallback(() => {
    setShowAdjust(false);
    setShowClose(false);
    setReviewAdj(null);
    setAdjAmount('');
  }, []);
  useCloseOnFetcherSuccess(fetcher, onSuccess);

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setSearchParams(next, { preventScrollReset: true });
  };

  const setView = (v: ReconciliationView) => {
    if (v === 'all') return go({ view: 'all', startDate: null, endDate: null, period: null });
    if (v === 'custom') return go({ view: 'custom', startDate, endDate });
    const p = periodFor(v, view === 'all' ? lagosToday() : startDate);
    go({ view: v, ...p });
  };
  const shift = (dir: -1 | 1) => go({ ...shiftPeriod(view, startDate, dir) });

  const doExport = async (kind: 'xlsx' | 'pdf') => {
    if (!data) return;
    setExporting(kind);
    try {
      if (kind === 'xlsx') await downloadReconciliationXlsx(data);
      else await downloadReconciliationPdf(data);
    } finally {
      setExporting(null);
    }
  };

  const selectedName = users.find((u) => u.id === selectedUserId)?.name ?? data?.user.name ?? '';
  const label = periodLabel(view, startDate, endDate);

  // ── Header tools ──────────────────────────────────────────────────────────
  const exportButtons = data ? (
    <>
      <Button variant="secondary" size="sm" className="h-12 md:h-auto w-full md:w-auto justify-center" loading={exporting === 'xlsx'} onClick={() => doExport('xlsx')}>
        Excel
      </Button>
      <Button variant="secondary" size="sm" className="h-12 md:h-auto w-full md:w-auto justify-center" loading={exporting === 'pdf'} onClick={() => doExport('pdf')}>
        PDF
      </Button>
    </>
  ) : null;
  const adminButtons = (
    <>
      {canAdjust && (
        <Button variant="secondary" size="sm" className="h-12 md:h-auto w-full md:w-auto justify-center" onClick={() => setShowAdjust(true)}>
          New adjustment
        </Button>
      )}
      {canClosePeriod && closable.length > 0 && (
        <Button
          variant="primary"
          size="sm"
          className="h-12 md:h-auto w-full md:w-auto justify-center"
          onClick={() => {
            setCloseMonth(closable[0]!);
            setShowClose(true);
          }}
        >
          {closable.length === 1 ? `Close ${monthName(closable[0]!)}` : 'Close a month'}
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Funding Reconciliation"
        backTo="/admin/marketing/funding"
        mobileInlineActions
        description={selectedName ? `${selectedName}: ${label}` : 'Opening, movements and closing balance for any period.'}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Tools"
            triggerAriaLabel="Reconciliation tools"
            desktop={
              <>
                {exportButtons}
                {adminButtons}
                <PageRefreshButton />
              </>
            }
            sheet={
              <>
                {exportButtons}
                {adminButtons}
                <Link to="/admin/marketing/funding/refunds" className="btn-secondary h-12 w-full inline-flex items-center justify-center">
                  Refunds
                </Link>
                <PageRefreshButton className="w-full justify-center py-2" />
              </>
            }
          />
        }
      />

      {/* Phones: the Actions button for the header tools sheet. */}
      <MobileDateFilterRow hideDate />

      {/* Controls: who, which kind of period, which period */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        {users.length > 1 ? (
          <SearchableSelect
            id="recon-user"
            value={selectedUserId}
            onChange={(v) => go({ userId: v || null })}
            options={users.map((u) => ({ value: u.id, label: u.name }))}
            placeholder="Choose a media buyer"
            wrapperClassName="w-full md:w-64"
          />
        ) : (
          <span />
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Tabs variant="pill" value={view} onChange={(v) => setView(v as ReconciliationView)} tabs={VIEW_TABS} />
          {view !== 'all' && (
            <FormSelect
              aria-label="Compare with"
              value={compare}
              onChange={(e) => go({ compare: e.target.value === 'none' ? null : e.target.value })}
              options={[
                { value: 'none', label: 'No comparison' },
                { value: 'previous', label: 'Compare: previous period' },
                { value: 'year', label: 'Compare: same period last year' },
              ]}
              wrapperClassName="w-full sm:w-56"
            />
          )}
          {view === 'custom' ? (
            <DateFilterBar startDate={startDate} endDate={endDate} chrome="pill" />
          ) : view !== 'all' ? (
            <div className="flex items-center justify-between gap-1 sm:justify-start">
              <button type="button" aria-label="Previous period" className="btn-secondary btn-sm px-2" onClick={() => shift(-1)}>
                ‹
              </button>
              <span className="min-w-[9rem] text-center text-sm font-medium text-app-fg">{label}</span>
              <button type="button" aria-label="Next period" className="btn-secondary btn-sm px-2" onClick={() => shift(1)}>
                ›
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {error && <Banner tone="danger">{error}</Banner>}
      {!selectedUserId && (
        <EmptyState title="Choose a media buyer" description="Pick someone to see how their balance was built up." />
      )}

      {data && <ReconciliationBody data={data} />}

      {(closes || adjustments.length > 0) && (
        <AdminPanels
          closes={closes}
          adjustments={adjustments}
          canAdjust={canAdjust}
          onReview={(row, action) => setReviewAdj({ row, action })}
        />
      )}

      {/* New adjustment */}
      {showAdjust && (
        <Modal open onClose={() => setShowAdjust(false)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <div>
            <h3 className="text-lg font-semibold text-app-fg">New adjustment</h3>
            <p className="text-sm text-app-fg-muted">A different approver must approve it before it changes the balance.</p>
          </div>
          <ModalFetcherInlineError message={surface.errorMatchingIntent('createAdjustment')} />
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="createAdjustment" />
            <FormSelect
              label="Person"
              name="userId"
              required
              defaultValue={selectedUserId}
              placeholder="Choose a person"
              options={users.map((u) => ({ value: u.id, label: u.name }))}
            />
            <FormSelect
              label="Type"
              name="direction"
              required
              defaultValue="DEBIT"
              options={[
                { value: 'CREDIT', label: 'Credit: adds to their balance' },
                { value: 'DEBIT', label: 'Debit: takes from their balance' },
              ]}
            />
            <div className="space-y-1">
              <label htmlFor="adj-amount" className="block text-sm font-medium text-app-fg">
                Amount
              </label>
              <AmountInput id="adj-amount" name="amount" required prefix="₦" value={adjAmount} onChange={setAdjAmount} />
            </div>
            {closes && closes.closes.length > 0 && (
              <FormSelect
                label="Corrects a closed month (optional)"
                name="relatedPeriodMonth"
                defaultValue=""
                options={[{ value: '', label: 'No' }, ...closes.closes.map((c) => ({ value: c.periodMonth, label: monthName(c.periodMonth) }))]}
              />
            )}
            <Textarea label="Reason" name="reason" required minLength={10} maxLength={500} rows={3} placeholder="e.g. Funding recorded twice on 3 Oct (min 10 chars)" />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="primary" loading={fetcher.state === 'submitting'} loadingText="Sending...">
                Send for approval
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setShowAdjust(false)}>
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Review an adjustment */}
      {reviewAdj && (
        <Modal open onClose={() => setReviewAdj(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <h3 className="text-lg font-semibold text-app-fg">
            {reviewAdj.action === 'approve' ? 'Approve' : 'Reject'} {reviewAdj.row.direction === 'CREDIT' ? 'credit' : 'debit'} of {naira(reviewAdj.row.amount)}?
          </h3>
          <p className="text-sm text-app-fg-muted">
            {reviewAdj.row.userName ?? 'Unknown'} · {reviewAdj.row.reference} · requested by {reviewAdj.row.requestedByName ?? 'Unknown'}
          </p>
          <p className="text-sm text-app-fg">{reviewAdj.row.reason}</p>
          <ModalFetcherInlineError message={surface.errorMatchingIntent(reviewAdj.action === 'approve' ? 'approveAdjustment' : 'rejectAdjustment')} />
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value={reviewAdj.action === 'approve' ? 'approveAdjustment' : 'rejectAdjustment'} />
            <input type="hidden" name="adjustmentId" value={reviewAdj.row.id} />
            {reviewAdj.action === 'reject' && (
              <Textarea label="Reason" name="note" required minLength={10} maxLength={500} rows={3} placeholder="Why it is rejected (min 10 chars)" />
            )}
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                variant={reviewAdj.action === 'approve' ? 'primary' : 'danger'}
                loading={fetcher.state === 'submitting'}
                loadingText="Saving..."
              >
                {reviewAdj.action === 'approve' ? 'Approve' : 'Reject'}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setReviewAdj(null)}>
                Back
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Close a month */}
      {showClose && closeMonth && (
        <Modal open onClose={() => setShowClose(false)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <h3 className="text-lg font-semibold text-app-fg">Close {monthName(closeMonth)}?</h3>
          {firstClose && closable.length > 1 && (
            <FormSelect
              label="First month to close"
              value={closeMonth}
              onChange={(e) => setCloseMonth(e.target.value)}
              options={closable.map((m) => ({ value: m, label: monthName(m) }))}
              hint="After this, months close one at a time in order."
            />
          )}
          <ul className="list-disc space-y-1 pl-5 text-sm text-app-fg">
            <li>Every media buyer and Head of Marketing in this company gets their {monthName(closeMonth)} figures frozen.</li>
            <li>Changes dated in {monthName(closeMonth)} or earlier after this show as prior-period corrections in the next month. Nothing changes silently.</li>
            <li>Months close in order. This cannot be undone.</li>
          </ul>
          <ModalFetcherInlineError message={surface.errorMatchingIntent('closePeriod')} />
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="closePeriod" />
            <input type="hidden" name="month" value={closeMonth} />
            <Textarea label="Note (optional)" name="note" maxLength={500} rows={2} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="primary" loading={fetcher.state === 'submitting'} loadingText="Closing...">
                Close {monthName(closeMonth)}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setShowClose(false)}>
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}
    </div>
  );
}

// ── The reconciliation itself ───────────────────────────────────────────────

function ReconciliationBody({ data }: { data: FundingReconciliation }) {
  const s = data.summary;
  const adjustmentsNet = num(s.credits) - num(s.debits);
  const items: OverviewStatStripItem[] = [
    { label: data.period.startDate ? 'Opening' : 'Starting', value: naira(s.opening), valueClassName: 'tabular-nums' },
    { label: 'Received', value: naira(s.received), valueClassName: 'tabular-nums text-success-600 dark:text-success-400' },
    { label: 'Expenses', value: naira(s.expenses), valueClassName: 'tabular-nums text-danger-600 dark:text-danger-400' },
    { label: 'Refunds paid', value: naira(s.refundsOut), valueClassName: 'tabular-nums text-danger-600 dark:text-danger-400' },
  ];
  if (num(s.refundsIn) !== 0) items.push({ label: 'Refunds back', value: naira(s.refundsIn), valueClassName: 'tabular-nums text-success-600 dark:text-success-400' });
  if (num(s.distributed) !== 0) items.push({ label: 'Sent on', value: naira(s.distributed), valueClassName: 'tabular-nums text-danger-600 dark:text-danger-400' });
  if (adjustmentsNet !== 0 || num(s.credits) !== 0) items.push({ label: 'Adjustments', value: signed(adjustmentsNet), valueClassName: `tabular-nums ${effectClass(adjustmentsNet)}` });
  if (num(s.corrections) !== 0) items.push({ label: 'Corrections', value: signed(s.corrections), valueClassName: `tabular-nums ${effectClass(s.corrections)}` });
  items.push({ label: 'Closing', value: naira(s.closing), valueClassName: 'tabular-nums font-bold text-brand-600 dark:text-brand-400' });

  const t = data.toDate;
  const toDateItems: OverviewStatStripItem[] = [
    { label: 'Received to date', value: naira(t.received), valueClassName: 'tabular-nums' },
    { label: 'Expenses to date', value: naira(t.expenses), valueClassName: 'tabular-nums' },
    { label: 'Refunds made', value: naira(t.refundsOut), valueClassName: 'tabular-nums' },
    { label: 'Refunds received', value: naira(t.refundsIn), valueClassName: 'tabular-nums' },
    { label: 'On hold', value: naira(num(t.pendingExpenses) + num(t.pendingRefunds)), valueClassName: 'tabular-nums text-warning-600 dark:text-warning-400' },
    { label: 'Available now', value: naira(t.available), valueClassName: 'tabular-nums font-bold' },
  ];

  return (
    <div className="space-y-4">
      {data.closedPeriod && (
        <Banner tone={num(data.closedPeriod.drift) === 0 ? 'info' : 'warning'}>
          <p>
            {monthName(data.closedPeriod.month)} was closed on {day(data.closedPeriod.closedAt)}
            {data.closedPeriod.closedByName ? ` by ${data.closedPeriod.closedByName}` : ''}. These are the frozen figures.
          </p>
          {num(data.closedPeriod.drift) !== 0 && (
            <>
              <p className="mt-1">
                Since then, changes dated in this month moved it by {signed(data.closedPeriod.drift)} (live closing {naira(data.closedPeriod.live.closing)}).
                They are carried into the next month as a prior-period correction.
              </p>
              <ChangedItems items={data.closedPeriod.changedItems} />
            </>
          )}
        </Banner>
      )}
      {data.priorCorrection && (
        <Banner tone="warning">
          <p>
            Includes {signed(data.priorCorrection.amount)} of prior-period corrections: changes dated in closed {monthName(data.priorCorrection.month)} or earlier.
          </p>
          <ChangedItems items={data.priorCorrection.changedItems} />
        </Banner>
      )}
      {data.overlapsClosed && (
        <Banner tone="info">This period includes a closed month. Figures here are live; open a closed month on its own to see its frozen figures.</Banner>
      )}

      <OverviewStatStrip mobileGrid items={items} />
      <OverviewStatStrip mobileGrid items={toDateItems} />

      <BalanceCheck data={data} />

      {data.comparison && <ComparisonTable data={data} />}

      {data.breakdown.length > 0 && (
        <Section title="Carry forward">
          <CompactTable
            columnVisibilityKey="admin.marketing.funding-reconciliation.breakdown"
            rows={data.breakdown}
            rowKey={(b) => b.startDate}
            columns={[
              { key: 'period', header: 'Period', nowrap: true, render: (b) => <span className="text-sm text-app-fg">{b.label}</span> },
              { key: 'opening', header: 'Opening', align: 'right', render: (b) => <span className="tabular-nums text-sm">{naira(b.opening)}</span> },
              { key: 'received', header: 'Received', align: 'right', render: (b) => <span className="tabular-nums text-sm">{naira(b.received)}</span> },
              { key: 'expenses', header: 'Expenses', align: 'right', render: (b) => <span className="tabular-nums text-sm">{naira(b.expenses)}</span> },
              {
                key: 'refunds',
                header: 'Refunds',
                align: 'right',
                render: (b) => {
                  const v = num(b.refundsIn) - num(b.refundsOut);
                  return <span className={`tabular-nums text-sm ${effectClass(v)}`}>{v === 0 ? naira(0) : signed(v)}</span>;
                },
              },
              {
                key: 'adjust',
                header: 'Adjustments',
                align: 'right',
                render: (b) => {
                  const v = num(b.credits) - num(b.debits) + num(b.corrections) - num(b.distributed);
                  return <span className={`tabular-nums text-sm ${effectClass(v)}`}>{v === 0 ? naira(0) : signed(v)}</span>;
                },
              },
              { key: 'closing', header: 'Closing', align: 'right', render: (b) => <span className="tabular-nums text-sm font-semibold">{naira(b.closing)}</span> },
            ]}
            renderMobileCard={(b) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-app-fg">{b.label}</span>
                  <span className="text-sm font-semibold tabular-nums">{naira(b.closing)}</span>
                </div>
                <p className="text-xs text-app-fg-muted tabular-nums">
                  Opening {naira(b.opening)} · in {naira(num(b.received) + num(b.refundsIn) + num(b.credits))} · out{' '}
                  {naira(num(b.expenses) + num(b.refundsOut) + num(b.debits) + num(b.distributed))}
                </p>
              </div>
            )}
          />
        </Section>
      )}

      <Section title="Transactions" aside={<span className="text-xs text-app-fg-muted">{data.movements.length}</span>}>
        <MovementsTable rows={data.movements} />
      </Section>

      {data.holds.length > 0 && (
        <Section title="On hold" aside={<span className="text-xs text-app-fg-muted">Not in the closing balance until final</span>}>
          <ul className="divide-y divide-app-border">
            {data.holds.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-app-fg">{h.description}</p>
                  <p className="text-xs text-app-fg-muted">
                    <span className="font-mono">{h.reference}</span> · {day(h.date)} · {h.kind === 'expense' ? 'Expense awaiting approval' : 'Refund not completed'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={h.status} size="sm" />
                  <span className="tabular-nums font-medium">{naira(h.amount)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="By funding" aside={<span className="text-xs text-app-fg-muted">Spending is matched first in, first out</span>}>
        {data.funders.length === 0 ? (
          <p className="px-4 pb-3 text-sm text-app-fg-muted">No funding received.</p>
        ) : (
          <CompactTable
            columnVisibilityKey="admin.marketing.funding-reconciliation.sources"
            rows={data.funders}
            rowKey={(f) => f.sourceId}
            columns={[
              { key: 'date', header: 'Received', nowrap: true, render: (f) => <span className="text-sm text-app-fg-muted">{day(f.at)}</span> },
              { key: 'ref', header: 'Reference', nowrap: true, render: (f) => <span className="font-mono text-xs text-app-fg-muted">{f.reference}</span> },
              { key: 'from', header: 'From', render: (f) => <span className="text-sm text-app-fg">{f.funderName ?? movementKindLabel(f.kind === 'adjustment' ? 'adjustment_credit' : f.kind)}</span> },
              { key: 'amount', header: 'Amount', align: 'right', render: (f) => <span className="tabular-nums text-sm">{naira(f.amount)}</span> },
              { key: 'refunded', header: 'Refunded', align: 'right', render: (f) => <span className="tabular-nums text-sm">{naira(f.refunded)}</span> },
              { key: 'used', header: 'Used', align: 'right', render: (f) => <span className="tabular-nums text-sm">{naira(f.used)}</span> },
              { key: 'remaining', header: 'Remaining', align: 'right', render: (f) => <span className="tabular-nums text-sm font-semibold">{naira(f.remaining)}</span> },
            ]}
            renderMobileCard={(f) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-app-fg">{f.funderName ?? f.reference}</span>
                  <span className="text-sm font-semibold tabular-nums">{naira(f.remaining)} left</span>
                </div>
                <p className="text-xs text-app-fg-muted tabular-nums">
                  {day(f.at)} · {naira(f.amount)} · used {naira(f.used)} · refunded {naira(f.refunded)}
                </p>
              </div>
            )}
          />
        )}
        {num(data.overdraft) > 0 && (
          <p className="px-4 pb-3 text-xs text-danger-600 dark:text-danger-400">Overspent by {naira(data.overdraft)} beyond all funding received.</p>
        )}
      </Section>
    </div>
  );
}

function BalanceCheck({ data }: { data: FundingReconciliation }) {
  const [open, setOpen] = useState(!data.check.ok);
  return (
    <Banner tone={data.check.ok ? 'success' : 'danger'}>
      <div className="flex items-center justify-between gap-2">
        <span>
          {data.check.ok
            ? `Balance check: transactions add up to the displayed available balance (${naira(data.check.systemAvailable)}).`
            : `Balance check: transactions add up to ${naira(data.check.derivedAvailable)} but the displayed balance is ${naira(data.check.systemAvailable)} (${signed(data.check.difference)}).`}
        </span>
        <button type="button" className="shrink-0 text-xs underline" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Details'}
        </button>
      </div>
      {open && (
        <table className="mt-2 w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left">
              <th className="py-1 font-medium">Part</th>
              <th className="py-1 text-right font-medium">From transactions</th>
              <th className="py-1 text-right font-medium">Displayed</th>
              <th className="py-1 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            {data.check.components.map((c) => (
              <tr key={c.key} className={num(c.difference) !== 0 ? 'font-semibold' : ''}>
                <td className="py-0.5">{c.label}</td>
                <td className="py-0.5 text-right">{naira(c.derived)}</td>
                <td className="py-0.5 text-right">{naira(c.system)}</td>
                <td className="py-0.5 text-right">{num(c.difference) === 0 ? '0' : signed(c.difference)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && data.check.items.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold">
            Transactions behind the difference ({data.check.itemCount}
            {data.check.itemCount > data.check.items.length ? `, first ${data.check.items.length} shown` : ''}):
          </p>
          <ul className="mt-1 space-y-1 text-xs">
            {data.check.items.map((i) => (
              <li key={`${i.kind}-${i.reference}`} className="flex flex-wrap gap-x-2">
                <span className="font-mono">{i.reference}</span>
                <span>{movementKindLabel(i.kind)}</span>
                <span>{day(i.date)}</span>
                <span>{i.status.toLowerCase()}</span>
                <span className="tabular-nums">
                  transactions {naira(i.derived)}, displayed {naira(i.system)}
                </span>
                <span>{i.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Banner>
  );
}

function ComparisonTable({ data }: { data: FundingReconciliation }) {
  const c = data.comparison!;
  const now = summaryLines(data.summary);
  const then = summaryLines(c.summary);
  const thisLabel = periodLabel(data.period.view, data.period.startDate ?? '', data.period.endDate ?? '');
  const thatLabel = periodLabel(data.period.view === 'all' ? 'custom' : data.period.view, c.startDate, c.endDate);
  return (
    <Section title="Compare periods">
      <div className="overflow-x-auto px-4 pb-3">
        <table className="w-full min-w-[28rem] text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-app-fg-muted">
              <th className="py-1.5 font-medium">Line</th>
              <th className="py-1.5 text-right font-medium">{thisLabel}</th>
              <th className="py-1.5 text-right font-medium">{thatLabel}</th>
              <th className="py-1.5 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {now.map((l, i) => {
              const prev = then[i]!.value;
              const diff = l.value - prev;
              return (
                <tr key={l.label} className={l.sign === '=' ? 'font-semibold' : ''}>
                  <td className="py-1.5 text-app-fg">{l.label}</td>
                  <td className="py-1.5 text-right">{naira(l.value)}</td>
                  <td className="py-1.5 text-right text-app-fg-muted">{naira(prev)}</td>
                  <td className={`py-1.5 text-right ${diff === 0 ? 'text-app-fg-muted' : 'text-app-fg'}`}>{diff === 0 ? '0' : signed(diff)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function MovementsTable({ rows }: { rows: ReconciliationMovement[] }) {
  const [peek, setPeek] = useState<ReconciliationMovement | null>(null);
  const columns = useMemo<CompactTableColumn<ReconciliationMovement>[]>(
    () => [
      { key: 'date', header: 'Date', nowrap: true, render: (m) => <span className="text-sm text-app-fg-muted">{day(m.date)}</span> },
      { key: 'ref', header: 'Reference', nowrap: true, render: (m) => <span className="font-mono text-xs text-app-fg-muted">{m.reference}</span> },
      { key: 'type', header: 'Type', nowrap: true, render: (m) => <span className="text-xs font-medium text-app-fg">{movementKindLabel(m.kind)}</span> },
      {
        key: 'desc',
        header: 'Description',
        render: (m) => (
          <span className="block max-w-[22rem] truncate text-sm text-app-fg" title={m.description}>
            {m.description}
          </span>
        ),
      },
      { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status} textOnly /> },
      { key: 'amount', header: 'Amount', align: 'right', nowrap: true, render: (m) => <span className={`tabular-nums text-sm font-medium ${effectClass(m.effect)}`}>{signed(m.effect)}</span> },
      { key: 'balance', header: 'Balance', align: 'right', nowrap: true, render: (m) => <span className="tabular-nums text-sm font-semibold">{naira(m.runningBalance)}</span> },
      { key: 'actions', header: '', align: 'right', tight: true, hideable: false, render: (m) => <TableActionButton onClick={() => setPeek(m)}>View</TableActionButton> },
    ],
    [],
  );
  if (rows.length === 0) return <p className="px-4 pb-3 text-sm text-app-fg-muted">No transactions in this period.</p>;
  return (
    <>
      <CompactTable<ReconciliationMovement>
        columnVisibilityKey="admin.marketing.funding-reconciliation.movements"
        columns={columns}
        rows={rows}
        rowKey={(m) => `${m.kind}-${m.id}`}
        renderMobileCard={(m) => (
          <button type="button" onClick={() => setPeek(m)} className="w-full space-y-1 text-left">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-app-fg">{movementKindLabel(m.kind)}</span>
              <span className={`text-sm font-semibold tabular-nums ${effectClass(m.effect)}`}>{signed(m.effect)}</span>
            </div>
            <p className="truncate text-sm text-app-fg">{m.description}</p>
            <div className="flex items-center justify-between text-xs text-app-fg-muted">
              <span>
                {day(m.date)} · {m.reference}
              </span>
              <span className="tabular-nums">Bal {naira(m.runningBalance)}</span>
            </div>
          </button>
        )}
      />
      {peek && (
        <Modal open onClose={() => setPeek(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-3 bg-app-elevated">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className={`text-lg font-semibold ${effectClass(peek.effect)}`}>{signed(peek.effect)}</h3>
              <p className="text-sm text-app-fg-muted">{movementKindLabel(peek.kind)}</p>
            </div>
            <StatusBadge status={peek.status} />
          </div>
          <dl className="space-y-1.5 rounded-lg border border-app-border bg-app-hover p-3 text-sm">
            {[
              ['Reference', peek.reference],
              ['Date', day(peek.date)],
              ...(peek.counterpartyName ? [['Counterparty', peek.counterpartyName]] : []),
              ...(peek.fundingReference && peek.kind !== 'funding_in' ? [['Original funding', peek.fundingReference]] : []),
              ['Balance after', naira(peek.runningBalance)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-app-fg-muted">{k}</dt>
                <dd className="text-right text-app-fg">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-app-fg">{peek.description}</p>
          <Button variant="secondary" size="sm" onClick={() => setPeek(null)}>
            Close
          </Button>
        </Modal>
      )}
    </>
  );
}

// ── Month close + adjustments (Finance / Admin) ─────────────────────────────

function AdminPanels({
  closes,
  adjustments,
  canAdjust,
  onReview,
}: {
  closes: FundingReconciliationLoaderData['closes'];
  adjustments: FundingAdjustmentRecord[];
  canAdjust: boolean;
  onReview: (row: FundingAdjustmentRecord, action: 'approve' | 'reject') => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {closes && (
        <Section title="Closed months">
          {!closes.groupId ? (
            <p className="px-4 pb-3 text-sm text-app-fg-muted">Select a company in the top bar to see and close months.</p>
          ) : closes.closes.length === 0 ? (
            <p className="px-4 pb-3 text-sm text-app-fg-muted">No month closed yet.</p>
          ) : (
            <ul className="divide-y divide-app-border">
              {closes.closes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <div>
                    <p className="font-medium text-app-fg">{monthName(c.periodMonth)}</p>
                    <p className="text-xs text-app-fg-muted">
                      {day(c.closedAt)} by {c.closedByName ?? 'Unknown'} · {c.userCount} people
                    </p>
                  </div>
                  <span className="tabular-nums text-app-fg">{naira(c.totalClosing)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
      {adjustments.length > 0 && (
        <Section title="Adjustments">
          <ul className="divide-y divide-app-border">
            {adjustments.map((a) => (
              <li key={a.id} className="space-y-1 px-4 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-app-fg">
                    {a.userName ?? 'Unknown'} · {a.direction === 'CREDIT' ? 'credit' : 'debit'}
                  </span>
                  <span className={`tabular-nums font-semibold ${a.direction === 'CREDIT' ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
                    {a.direction === 'CREDIT' ? '+' : '-'}
                    {naira(a.amount)}
                  </span>
                </div>
                <p className="line-clamp-2 text-xs text-app-fg-muted">{a.reason}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-app-fg-muted">
                    <span className="font-mono">{a.reference}</span> · {day(a.requestedAt)} by {a.requestedByName ?? 'Unknown'}
                  </span>
                  {a.status === 'PENDING' && canAdjust && a.canReview ? (
                    <span className="inline-flex gap-1.5">
                      <TableActionButton onClick={() => onReview(a, 'approve')}>Approve</TableActionButton>
                      <TableActionButton variant="danger" onClick={() => onReview(a, 'reject')}>
                        Reject
                      </TableActionButton>
                    </span>
                  ) : (
                    <StatusBadge status={a.status} size="sm" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
