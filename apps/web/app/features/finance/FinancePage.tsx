import { useState, useEffect, useMemo } from 'react';
import { useFetcher, useSearchParams, useNavigation } from '@remix-run/react';
import { exportToCsv } from '~/lib/csv-export';
import { useFetcherToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { previewInvoicePdf } from '~/lib/invoice-pdf';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { Spinner } from '~/components/ui/spinner';
import { Tabs } from '~/components/ui/tabs';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { NairaPrice } from '~/components/ui/naira-price';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { formatNaira } from '~/lib/format-amount';
import type { FinanceStreamData, Invoice, ApprovalRequest, BudgetWithUtilization } from './types';

const ITEMS_PER_PAGE = 15;


const APPROVAL_TYPE_LABELS: Record<string, string> = {
  MEDIA_SPEND: 'Media Spend',
  PROCUREMENT: 'Procurement',
  LOGISTICS_REIMBURSEMENT: 'Logistics',
  AD_HOC: 'Ad Hoc',
};

export function FinancePage({ data }: { data: FinanceStreamData }) {
  const { invoices, totalInvoices, profit, filters } = data;
  const fetcher = useFetcher();
  const approvalFetcher = useFetcher();
  const overdueFetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';

  // Auto-flag overdue invoices on page load
  useEffect(() => {
    if (overdueFetcher.state === 'idle' && !overdueFetcher.data) {
      overdueFetcher.submit(
        { intent: 'flagOverdueInvoices' },
        { method: 'post' },
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [activeTab, setActiveTab] = useState<'overview' | 'invoices' | 'approvals'>('overview');
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [lineItems, setLineItems] = useState<{ description: string; quantity: number; unitPrice: string }[]>([
    { description: '', quantity: 1, unitPrice: '' },
  ]);
  const [approvalModal, setApprovalModal] = useState<{ requestId: string; action: string } | null>(null);
  const [approvalReason, setApprovalReason] = useState('');
  const [invoicePage, setInvoicePage] = useState(1);

  useFetcherToast(fetcher.data, { successMessage: 'Invoice updated' });
  useFetcherToast(approvalFetcher.data, { successMessage: 'Approval processed' });

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  const [dismissedError, setDismissedError] = useState(false);

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  if (actionSuccess && showInvoiceForm) setShowInvoiceForm(false);

  // Memoize cost calculations
  const costWaterfall = useMemo(() => [
    { label: 'Revenue', value: profit.revenue, type: 'revenue' as const },
    { label: 'Landed COGS', value: profit.landedCost, type: 'cost' as const },
    { label: 'Delivery Fees', value: profit.deliveryFee, type: 'cost' as const },
    { label: 'Ad Spend', value: profit.adSpend, type: 'cost' as const },
    { label: 'Commission', value: profit.commission, type: 'cost' as const },
    { label: 'Fulfillment', value: profit.fulfillmentCost, type: 'cost' as const },
    { label: 'Operational Loss', value: profit.operationalLoss, type: 'cost' as const },
  ], [profit]);

  const totalCosts = useMemo(() =>
    profit.landedCost + profit.deliveryFee + profit.adSpend + profit.commission + profit.fulfillmentCost + profit.operationalLoss,
    [profit],
  );
  const getBarWidth = (value: number) => profit.revenue > 0 ? Math.max((value / profit.revenue) * 100, 2) : 0;

  const perOrder = useMemo(() => {
    const n = profit.orderCount;
    if (n <= 0) return { aov: 0, costPerOrder: 0, profitPerOrder: 0 };
    return {
      aov: profit.revenue / n,
      costPerOrder: totalCosts / n,
      profitPerOrder: profit.trueProfit / n,
    };
  }, [profit, totalCosts]);

  // Client-side invoice pagination
  const invoiceTotalPages = Math.ceil(invoices.length / ITEMS_PER_PAGE);
  const paginatedInvoices = useMemo(() =>
    invoices.slice((invoicePage - 1) * ITEMS_PER_PAGE, invoicePage * ITEMS_PER_PAGE),
    [invoices, invoicePage],
  );

  // Reset page when filters change
  useEffect(() => { setInvoicePage(1); }, [filters.invoiceStatus, filters.startDate, filters.endDate]);

  const addLineItem = () => {
    setLineItems([...lineItems, { description: '', quantity: 1, unitPrice: '' }]);
  };

  const removeLineItem = (idx: number) => {
    setLineItems(lineItems.filter((_, i) => i !== idx));
  };

  const updateLineItem = (idx: number, field: keyof typeof lineItems[0], value: string | number) => {
    setLineItems(lineItems.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const invoiceSubtotal = lineItems.reduce(
    (sum, item) => sum + (item.quantity * Number(item.unitPrice || 0)),
    0,
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Finance"
        description="True profit tracking, invoicing, and financial overview"
        actions={
          <>
            <PageRefreshButton />
            <DateFilterBar
              startDate={filters.startDate}
              endDate={filters.endDate}
              periodAllTime={filters.periodAllTime ?? false}
            />
            {isFilterLoading && (
              <span className="flex items-center text-app-fg-muted" aria-hidden>
                <Spinner size="sm" className="shrink-0" />
              </span>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => exportToCsv(
                invoices.map((inv: Invoice) => ({
                  reference: inv.referenceFormatted ?? `INV-${inv.referenceNumber}`,
                  orderId: inv.orderId ?? '',
                  amount: inv.totalAmount,
                  status: inv.status,
                  dueDate: inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '',
                })),
                [
                  { key: 'reference', label: 'Reference' },
                  { key: 'orderId', label: 'Order ID' },
                  { key: 'amount', label: 'Amount' },
                  { key: 'status', label: 'Status' },
                  { key: 'dueDate', label: 'Due Date' },
                ],
                `invoices-${new Date().toISOString().split('T')[0]}.csv`,
              )}
            >
              Export CSV
            </Button>
            <Button variant="primary" size="sm" onClick={() => { setShowInvoiceForm(!showInvoiceForm); setActiveTab('invoices'); }}>
              {showInvoiceForm ? 'Close' : '+ Create Invoice'}
            </Button>
          </>
        }
      />

      {actionError && !dismissedError && (
        <PageNotification
          variant="error"
          message={actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      <OverviewStatStrip
        items={[
          {
            label: 'Revenue',
            value: formatNaira(Math.round(profit.revenue)),
            valueClassName: 'text-app-fg tabular-nums',
            title: `${profit.orderCount} delivered orders`,
          },
          {
            label: 'True Profit',
            value: formatNaira(Math.round(profit.trueProfit)),
            valueClassName:
              profit.trueProfit >= 0 ? 'text-success-600 dark:text-success-400 tabular-nums' : 'text-danger-600 dark:text-danger-400 tabular-nums',
            title: 'After all costs',
          },
          {
            label: 'Net Margin',
            value: <>{profit.margin.toFixed(1)}%</>,
            valueClassName:
              profit.margin >= 20
                ? 'text-success-600 dark:text-success-400 tabular-nums'
                : profit.margin > 0
                  ? 'text-warning-600 dark:text-warning-400 tabular-nums'
                  : 'text-danger-600 dark:text-danger-400 tabular-nums',
            title: 'Profit / Revenue',
          },
          {
            label: 'Total Costs',
            value: formatNaira(Math.round(totalCosts)),
            valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums',
            title: 'All cost layers',
          },
          {
            label: 'AOV',
            value: formatNaira(Math.round(perOrder.aov)),
            valueClassName: 'text-app-fg tabular-nums',
            title: 'Average order value',
          },
          {
            label: 'Cost / Order',
            value: formatNaira(Math.round(perOrder.costPerOrder)),
            valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums',
            title: 'Total costs / orders',
          },
          {
            label: 'Profit / Order',
            value: formatNaira(Math.round(perOrder.profitPerOrder)),
            valueClassName:
              perOrder.profitPerOrder >= 0 ? 'text-success-600 dark:text-success-400 tabular-nums' : 'text-danger-600 dark:text-danger-400 tabular-nums',
            title: 'True profit / orders',
          },
          {
            label: 'Pending Approvals',
            value: (
              <DeferredSection resolve={data.pendingApprovalsValue} skeleton="inline">
                {(v) => <>{formatNaira(Math.round(v as number))}</>}
              </DeferredSection>
            ),
            valueClassName: 'text-warning-600 dark:text-warning-400 tabular-nums',
            title: 'Total amount waiting on finance approval',
          },
        ]}
      />

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as typeof activeTab)}
        tabs={[
          { value: 'overview', label: 'Profit Breakdown' },
          { value: 'invoices', label: `Invoices (${totalInvoices})` },
          {
            value: 'approvals',
            label: 'Approvals',
            badge: (
              <DeferredSection resolve={data.pendingApprovals} skeleton="inline">
                {(count) =>
                  count > 0 ? (
                    <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-warning-500 text-white rounded-full">
                      {count}
                    </span>
                  ) : null
                }
              </DeferredSection>
            ),
          },
        ]}
      />

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Cost Waterfall */}
          <div className="card">
            <h3 className="text-lg font-semibold text-app-fg mb-4">Cost Waterfall</h3>
            <p className="text-xs text-app-fg-muted mb-4">
              Revenue - (COGS + Delivery + Ads + Commission + Fulfillment + Loss) = True Profit
            </p>
            <div className="space-y-3">
              {costWaterfall.map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm text-app-fg-muted">{item.label}</span>
                    <span className={`text-sm font-medium ${item.type === 'revenue' ? 'text-app-fg' : 'text-danger-600 dark:text-danger-400'}`}>
                      {item.type === 'cost' ? formatNaira(-Math.round(item.value)) : formatNaira(Math.round(item.value))}
                    </span>
                  </div>
                  <div className="w-full bg-app-hover rounded-full h-2.5">
                    <div
                      className={`h-2.5 rounded-full transition-all ${item.type === 'revenue' ? 'bg-brand-500' : 'bg-danger-400 dark:bg-danger-500'}`}
                      style={{ width: `${getBarWidth(item.value)}%` }}
                    />
                  </div>
                </div>
              ))}
              <div className="pt-3 border-t-2 border-app-border">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-semibold text-app-fg">True Profit</span>
                  <span className={`text-lg font-bold ${profit.trueProfit >= 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
                    {formatNaira(Math.round(profit.trueProfit))}
                  </span>
                </div>
                <div className="w-full bg-app-hover rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all ${profit.trueProfit >= 0 ? 'bg-success-500' : 'bg-danger-500'}`}
                    style={{ width: `${Math.abs(getBarWidth(profit.trueProfit))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Cost Distribution + Invoice Summary */}
          <div className="space-y-4">
            {/* Cost Distribution */}
            <div className="card">
              <h3 className="text-lg font-semibold text-app-fg mb-4">Cost Distribution</h3>
              <div className="space-y-3">
                {totalCosts > 0 ? (
                  <>
                    {[
                      { label: 'Landed COGS', value: profit.landedCost, pct: (profit.landedCost / totalCosts) * 100, color: 'bg-danger-400' },
                      { label: 'Delivery Fees', value: profit.deliveryFee, pct: (profit.deliveryFee / totalCosts) * 100, color: 'bg-warning-400' },
                      { label: 'Ad Spend', value: profit.adSpend, pct: (profit.adSpend / totalCosts) * 100, color: 'bg-brand-400' },
                      { label: 'Commission', value: profit.commission, pct: (profit.commission / totalCosts) * 100, color: 'bg-info-400' },
                      { label: 'Fulfillment', value: profit.fulfillmentCost, pct: (profit.fulfillmentCost / totalCosts) * 100, color: 'bg-surface-400' },
                      { label: 'Operational Loss', value: profit.operationalLoss, pct: (profit.operationalLoss / totalCosts) * 100, color: 'bg-danger-600' },
                    ].filter((item) => item.value > 0).map((item) => (
                      <div key={item.label} className="flex items-center justify-between py-1.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded-sm ${item.color}`} />
                          <span className="text-sm text-app-fg-muted">{item.label}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-medium text-app-fg">{formatNaira(Math.round(item.value))}</span>
                          <span className="text-xs text-app-fg-muted ml-2">({item.pct.toFixed(1)}%)</span>
                        </div>
                      </div>
                    ))}
                    {/* Stacked bar */}
                    <div className="w-full flex rounded-full h-3 overflow-hidden mt-2">
                      <div className="bg-danger-400" style={{ width: `${(profit.landedCost / totalCosts) * 100}%` }} />
                      <div className="bg-warning-400" style={{ width: `${(profit.deliveryFee / totalCosts) * 100}%` }} />
                      <div className="bg-brand-400" style={{ width: `${(profit.adSpend / totalCosts) * 100}%` }} />
                      <div className="bg-info-400" style={{ width: `${(profit.commission / totalCosts) * 100}%` }} />
                      <div className="bg-surface-400" style={{ width: `${(profit.fulfillmentCost / totalCosts) * 100}%` }} />
                      <div className="bg-danger-600" style={{ width: `${(profit.operationalLoss / totalCosts) * 100}%` }} />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-app-fg-muted">No cost data available</p>
                )}
              </div>
            </div>

            {/* Receivables — Deferred (replaces simple invoice summary) */}
            <DeferredSection resolve={data.invoiceSummary} skeleton="card">
              {(invoiceSummary) => {
                const summary = invoiceSummary as Record<string, { count: number; total: string }>;
                const paidTotal = Number(summary['PAID']?.total ?? 0);
                const outstandingTotal = Number(summary['SENT']?.total ?? 0);
                const overdueTotal = Number(summary['OVERDUE']?.total ?? 0);
                const draftTotal = Number(summary['DRAFT']?.total ?? 0);
                const billed = paidTotal + outstandingTotal + overdueTotal;
                const collectionRate = billed > 0 ? (paidTotal / billed) * 100 : 0;
                const buckets = [
                  { key: 'PAID', label: 'Paid', total: paidTotal, count: summary['PAID']?.count ?? 0, color: 'bg-success-500', text: 'text-success-600 dark:text-success-400' },
                  { key: 'SENT', label: 'Outstanding', total: outstandingTotal, count: summary['SENT']?.count ?? 0, color: 'bg-warning-500', text: 'text-warning-600 dark:text-warning-400' },
                  { key: 'OVERDUE', label: 'Overdue', total: overdueTotal, count: summary['OVERDUE']?.count ?? 0, color: 'bg-danger-500', text: 'text-danger-600 dark:text-danger-400' },
                  { key: 'DRAFT', label: 'Draft', total: draftTotal, count: summary['DRAFT']?.count ?? 0, color: 'bg-surface-400', text: 'text-app-fg-muted' },
                ];

                return (
                  <div className="card">
                    <div className="flex items-baseline justify-between mb-3">
                      <h3 className="text-lg font-semibold text-app-fg">Receivables</h3>
                      <span
                        className={`text-xs font-medium tabular-nums ${
                          collectionRate >= 80
                            ? 'text-success-600 dark:text-success-400'
                            : collectionRate >= 50
                              ? 'text-warning-600 dark:text-warning-400'
                              : 'text-danger-600 dark:text-danger-400'
                        }`}
                        title="Paid / (Paid + Outstanding + Overdue)"
                      >
                        {collectionRate.toFixed(1)}% collected
                      </span>
                    </div>

                    {/* Collection progress bar */}
                    {billed > 0 && (
                      <div className="w-full flex rounded-full h-2 overflow-hidden mb-4">
                        <div className="bg-success-500" style={{ width: `${(paidTotal / billed) * 100}%` }} />
                        <div className="bg-warning-500" style={{ width: `${(outstandingTotal / billed) * 100}%` }} />
                        <div className="bg-danger-500" style={{ width: `${(overdueTotal / billed) * 100}%` }} />
                      </div>
                    )}

                    <div className="space-y-2.5">
                      {buckets.map((b) => (
                        <div key={b.key} className="flex justify-between items-center">
                          <span className="flex items-center gap-2 text-sm text-app-fg-muted">
                            <span className={`w-2 h-2 rounded-full ${b.color}`} />
                            {b.label}
                          </span>
                          <span className={`text-sm font-medium tabular-nums ${b.text}`}>
                            {formatNaira(b.total)}
                            <span className="text-xs text-app-fg-muted ml-1">({b.count})</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }}
            </DeferredSection>

            {/* Budget Utilization — NEW (surfaces previously orphaned data) */}
            <DeferredSection resolve={data.budgets} skeleton="card">
              {(budgets) => {
                const list = budgets as BudgetWithUtilization[];
                const active = list.filter((b) => b.isActive);
                const display = active.length > 0 ? active : list.slice(0, 3);

                return (
                  <div className="card">
                    <div className="flex items-baseline justify-between mb-3">
                      <h3 className="text-lg font-semibold text-app-fg">Budgets</h3>
                      <span className="text-xs text-app-fg-muted">
                        {active.length} active{list.length > active.length ? ` · ${list.length - active.length} ended` : ''}
                      </span>
                    </div>

                    {display.length === 0 ? (
                      <p className="text-sm text-app-fg-muted">No budgets configured.</p>
                    ) : (
                      <div className="space-y-3">
                        {display.slice(0, 4).map((b) => {
                          const pct = Math.min(b.utilizationPct, 100);
                          const overBudget = b.remaining < 0;
                          const barColor = overBudget
                            ? 'bg-danger-500'
                            : pct >= 90
                              ? 'bg-warning-500'
                              : pct >= 70
                                ? 'bg-warning-400'
                                : 'bg-brand-500';
                          return (
                            <div key={b.id}>
                              <div className="flex justify-between items-baseline mb-1">
                                <span className="text-sm font-medium text-app-fg truncate mr-2" title={b.name}>
                                  {b.name}
                                </span>
                                <span
                                  className={`text-xs font-medium tabular-nums whitespace-nowrap ${
                                    overBudget
                                      ? 'text-danger-600 dark:text-danger-400'
                                      : pct >= 90
                                        ? 'text-warning-600 dark:text-warning-400'
                                        : 'text-app-fg-muted'
                                  }`}
                                >
                                  {formatNaira(Math.round(b.approved + b.committed))} / {formatNaira(Math.round(b.total))}
                                </span>
                              </div>
                              <div className="w-full bg-app-hover rounded-full h-1.5 overflow-hidden">
                                <div
                                  className={`h-full ${barColor} transition-all`}
                                  style={{ width: `${Math.max(pct, 2)}%` }}
                                />
                              </div>
                              <div className="flex justify-between mt-1 text-[11px] text-app-fg-muted tabular-nums">
                                <span>
                                  Approved {formatNaira(Math.round(b.approved))} · Pending {formatNaira(Math.round(b.committed))}
                                </span>
                                <span className={overBudget ? 'text-danger-600 dark:text-danger-400 font-medium' : ''}>
                                  {overBudget ? `Over by ${formatNaira(Math.round(-b.remaining))}` : `${formatNaira(Math.round(b.remaining))} left`}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                        {display.length > 4 && (
                          <p className="text-xs text-app-fg-muted text-center pt-1">
                            +{display.length - 4} more
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              }}
            </DeferredSection>
          </div>
        </div>
      )}

      {activeTab === 'invoices' && (
        <>
          {/* Create Invoice Form */}
          <ResponsiveFormPanel open={showInvoiceForm} onClose={() => setShowInvoiceForm(false)}>
            <fetcher.Form method="post" className="card space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-app-fg">Create Invoice</h3>
                <button type="button" onClick={() => setShowInvoiceForm(false)} className="text-app-fg-muted hover:text-app-fg">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <input type="hidden" name="intent" value="createInvoice" />
              <input type="hidden" name="lineItems" value={JSON.stringify(lineItems.filter(i => i.description && i.unitPrice))} />

              {/* Recipient Info */}
              <div>
                <p className="text-sm font-medium text-app-fg-muted mb-2">Recipient</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <TextInput label="Name" name="recipientName" required placeholder="Customer name" />
                  <TextInput label="Email" name="recipientEmail" type="email" placeholder="email@example.com" />
                  <TextInput label="Address" name="recipientAddress" placeholder="Address" />
                </div>
              </div>

              {/* Line Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-app-fg-muted">Line Items</p>
                  <Button type="button" variant="secondary" size="sm" className="text-xs" onClick={addLineItem}>
                    + Add Item
                  </Button>
                </div>
                <div className="space-y-2">
                  {lineItems.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-5">
                        <TextInput
                          label={idx === 0 ? 'Description' : undefined}
                          value={item.description}
                          onChange={(e) => updateLineItem(idx, 'description', e.target.value)}
                          placeholder="Item description"
                        />
                      </div>
                      <div className="col-span-2">
                        <TextInput
                          label={idx === 0 ? 'Qty' : undefined}
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(e) => updateLineItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                        />
                      </div>
                      <div className="col-span-3">
                        {idx === 0 && <label className="block text-xs text-app-fg-muted mb-1">Unit Price</label>}
                        <AmountInput
                          value={item.unitPrice}
                          onChange={(v) => updateLineItem(idx, 'unitPrice', v)}
                          placeholder="0.00"
                        />
                      </div>
                      <div className="col-span-2 flex items-center justify-between">
                        {idx === 0 && <label className="block text-xs text-app-fg-muted mb-1 invisible">Del</label>}
                        <span className="text-xs font-medium text-app-fg-muted">
                          {formatNaira(item.quantity * Number(item.unitPrice || 0))}
                        </span>
                        {lineItems.length > 1 && (
                          <button type="button" onClick={() => removeLineItem(idx)} className="text-danger-500 hover:text-danger-600 ml-1">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mt-2">
                  <p className="text-sm font-medium text-app-fg">
                    Subtotal: {formatNaira(invoiceSubtotal)}
                  </p>
                </div>
              </div>

              {/* Tax & Due Date */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <TextInput label="Tax Rate (decimal)" name="taxRate" placeholder="e.g. 0.075 for 7.5%" pattern="^\d+(\.\d{1,4})?$" />
                <TextInput label="Due Date" name="dueDate" type="date" />
                <TextInput label="Order ID (optional)" name="orderId" placeholder="Link to order..." />
              </div>

              <div className="flex gap-2">
                <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Creating...">
                  Create Invoice
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowInvoiceForm(false)}>
                  Cancel
                </Button>
              </div>
            </fetcher.Form>
          </ResponsiveFormPanel>

          {/* Invoice Table */}
          <div className="card p-0 overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Reference</th>
                    <th className="table-header">Recipient</th>
                    <th className="table-header text-right">Amount</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Due Date</th>
                    <th className="table-header">Created</th>
                    <th className="table-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedInvoices.map((inv: Invoice) => (
                    <tr key={inv.id} className="table-row">
                      <td className="table-cell font-mono font-medium text-app-fg text-sm">{inv.referenceFormatted}</td>
                      <td className="table-cell text-sm text-app-fg-muted">
                        {inv.recipientInfo?.name ?? '\u2014'}
                      </td>
                      <td className="table-cell text-right font-medium"><NairaPrice amount={Number(inv.totalAmount)} /></td>
                      <td className="table-cell">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="table-cell text-app-fg-muted text-sm">
                        {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' }) : '\u2014'}
                      </td>
                      <td className="table-cell text-app-fg-muted text-sm">
                        {new Date(inv.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => previewInvoicePdf(inv)}
                            className="p-1 rounded text-app-fg-muted hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors"
                            title="Preview PDF"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          </button>
                          {inv.status === 'DRAFT' && (
                            <fetcher.Form method="post" className="inline">
                              <input type="hidden" name="intent" value="updateInvoiceStatus" />
                              <input type="hidden" name="invoiceId" value={inv.id} />
                              <input type="hidden" name="status" value="SENT" />
                              <Button type="submit" variant="primary" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Sending...">
                                Send
                              </Button>
                            </fetcher.Form>
                          )}
                          {inv.status === 'SENT' && (
                            <>
                              <fetcher.Form method="post" className="inline">
                                <input type="hidden" name="intent" value="updateInvoiceStatus" />
                                <input type="hidden" name="invoiceId" value={inv.id} />
                                <input type="hidden" name="status" value="PAID" />
                                <Button type="submit" variant="success" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Updating...">
                                  Paid
                                </Button>
                              </fetcher.Form>
                              <fetcher.Form method="post" className="inline">
                                <input type="hidden" name="intent" value="updateInvoiceStatus" />
                                <input type="hidden" name="invoiceId" value={inv.id} />
                                <input type="hidden" name="status" value="OVERDUE" />
                                <Button type="submit" variant="danger" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Updating...">
                                  Overdue
                                </Button>
                              </fetcher.Form>
                            </>
                          )}
                          {inv.status === 'OVERDUE' && (
                            <fetcher.Form method="post" className="inline">
                              <input type="hidden" name="intent" value="updateInvoiceStatus" />
                              <input type="hidden" name="invoiceId" value={inv.id} />
                              <input type="hidden" name="status" value="PAID" />
                              <Button type="submit" variant="success" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Updating...">
                                Mark Paid
                              </Button>
                            </fetcher.Form>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {paginatedInvoices.length === 0 && (
                    <tr><td colSpan={7}><EmptyState title="No invoices yet" /></td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden space-y-3 px-1">
              {paginatedInvoices.map((inv: Invoice) => (
                <div key={inv.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium text-app-fg text-sm">{inv.referenceFormatted}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => previewInvoicePdf(inv)}
                        className="p-1 rounded text-app-fg-muted hover:text-brand-500 transition-colors"
                        title="Preview PDF"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </button>
                      <StatusBadge status={inv.status} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-app-fg-muted">{inv.recipientInfo?.name ?? '\u2014'}</span>
                    <NairaPrice amount={Number(inv.totalAmount)} className="font-medium text-app-fg" />
                  </div>
                  {inv.status === 'DRAFT' && (
                    <fetcher.Form method="post" className="pt-1">
                      <input type="hidden" name="intent" value="updateInvoiceStatus" />
                      <input type="hidden" name="invoiceId" value={inv.id} />
                      <input type="hidden" name="status" value="SENT" />
                      <Button type="submit" variant="primary" size="sm" className="text-xs w-full">Send Invoice</Button>
                    </fetcher.Form>
                  )}
                  {inv.status === 'SENT' && (
                    <div className="flex gap-2 pt-1">
                      <fetcher.Form method="post" className="flex-1">
                        <input type="hidden" name="intent" value="updateInvoiceStatus" />
                        <input type="hidden" name="invoiceId" value={inv.id} />
                        <input type="hidden" name="status" value="PAID" />
                        <Button type="submit" variant="success" size="sm" className="text-xs w-full">Mark Paid</Button>
                      </fetcher.Form>
                      <fetcher.Form method="post" className="flex-1">
                        <input type="hidden" name="intent" value="updateInvoiceStatus" />
                        <input type="hidden" name="invoiceId" value={inv.id} />
                        <input type="hidden" name="status" value="OVERDUE" />
                        <Button type="submit" variant="danger" size="sm" className="text-xs w-full">Overdue</Button>
                      </fetcher.Form>
                    </div>
                  )}
                </div>
              ))}
              {paginatedInvoices.length === 0 && (
                <EmptyState title="No invoices yet" />
              )}
            </div>

            {/* Pagination */}
            {invoiceTotalPages > 1 && (
              <div className="px-4 py-3 border-t border-app-border">
                <Pagination
                  page={invoicePage}
                  totalPages={invoiceTotalPages}
                  onPageChange={setInvoicePage}
                />
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'approvals' && (
        <DeferredSection resolve={data.approvals} skeleton="table">
          {(resolvedApprovals) => {
            const allApprovals = resolvedApprovals as ApprovalRequest[];
            return <ApprovalsTab
              approvals={allApprovals}
              filters={filters}
              searchParams={searchParams}
              setSearchParams={setSearchParams}
              setApprovalModal={setApprovalModal}
              setApprovalReason={setApprovalReason}
            />;
          }}
        </DeferredSection>
      )}

      {/* Approval Modal + rest */}
      {approvalModal && (
        <Modal open onClose={() => setApprovalModal(null)} maxWidth="max-w-md" backdropBlur contentClassName="p-6 flex flex-col max-h-[80dvh] overflow-hidden border border-app-border bg-app-elevated">
              <h3 className="text-lg font-semibold text-app-fg shrink-0">
                {approvalModal.action === 'APPROVED' ? 'Approve Request' : approvalModal.action === 'REJECTED' ? 'Reject Request' : 'Query Request'}
              </h3>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
                <div>
                  <Textarea
                    label="Reason (min 5 characters)"
                    value={approvalReason}
                    onChange={(e) => setApprovalReason(e.target.value)}
                    rows={3}
                    placeholder={
                      approvalModal.action === 'APPROVED' ? 'Reason for approval...'
                      : approvalModal.action === 'REJECTED' ? 'Reason for rejection...'
                      : 'What needs clarification?'
                    }
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end shrink-0 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <Button type="button" variant="secondary" size="sm" onClick={() => setApprovalModal(null)}>
                  Cancel
                </Button>
                <approvalFetcher.Form method="post" onSubmit={() => setApprovalModal(null)}>
                  <input type="hidden" name="intent" value="processApproval" />
                  <input type="hidden" name="requestId" value={approvalModal.requestId} />
                  <input type="hidden" name="action" value={approvalModal.action} />
                  <input type="hidden" name="reason" value={approvalReason} />
                  <Button
                    type="submit"
                    variant={approvalModal.action === 'APPROVED' ? 'success' : approvalModal.action === 'REJECTED' ? 'danger' : 'primary'}
                    size="sm"
                    disabled={approvalReason.length < 5}
                    loading={approvalFetcher.state === 'submitting'}
                    loadingText="Processing..."
                  >
                    Confirm
                  </Button>
                </approvalFetcher.Form>
              </div>
        </Modal>
      )}
    </div>
  );
}

/* ── Approvals sub-component with built-in pagination ── */
function ApprovalsTab({
  approvals,
  filters,
  searchParams,
  setSearchParams,
  setApprovalModal,
  setApprovalReason,
}: {
  approvals: ApprovalRequest[];
  filters: { approvalStatus: string };
  searchParams: URLSearchParams;
  setSearchParams: (p: URLSearchParams) => void;
  setApprovalModal: (v: { requestId: string; action: string } | null) => void;
  setApprovalReason: (v: string) => void;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(approvals.length / ITEMS_PER_PAGE);
  const paginated = useMemo(
    () => approvals.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE),
    [approvals, page],
  );

  useEffect(() => { setPage(1); }, [filters.approvalStatus]);

  return (
    <>
      {/* Approval Status Filter */}
      <div className="flex gap-2 flex-wrap">
        {['', 'PENDING', 'APPROVED', 'REJECTED', 'QUERIED'].map((status) => (
          <button
            key={status}
            onClick={() => {
              const params = new URLSearchParams(searchParams);
              if (status) params.set('approvalStatus', status);
              else params.delete('approvalStatus');
              setSearchParams(params);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              filters.approvalStatus === status
                ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
                : 'bg-app-elevated border-app-border text-app-fg-muted hover:border-app-border'
            }`}
          >
            {status || 'All'}
          </button>
        ))}
      </div>

      {/* Approval Queue Table */}
      <div className="card p-0 overflow-hidden mt-4">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Type</th>
                <th className="table-header">Description</th>
                <th className="table-header text-right">Amount</th>
                <th className="table-header">Status</th>
                <th className="table-header">Submitted</th>
                <th className="table-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((req) => (
                <tr key={req.id} className="table-row">
                  <td className="table-cell">
                    <span className="text-xs font-medium px-2 py-0.5 rounded bg-app-hover text-app-fg-muted">
                      {APPROVAL_TYPE_LABELS[req.type] ?? req.type}
                    </span>
                  </td>
                  <td className="table-cell text-sm text-app-fg-muted max-w-xs truncate">
                    {req.description}
                  </td>
                  <td className="table-cell text-right font-medium text-app-fg">
                    <NairaPrice amount={Number(req.amount)} />
                  </td>
                  <td className="table-cell">
                    <StatusBadge status={req.status} />
                  </td>
                  <td className="table-cell text-app-fg-muted text-sm">
                    {new Date(req.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                  </td>
                  <td className="table-cell">
                    {(req.status === 'PENDING' || req.status === 'QUERIED') && (
                      <div className="flex gap-1.5">
                        <Button type="button" variant="success" size="sm" className="text-xs"
                          onClick={() => { setApprovalModal({ requestId: req.id, action: 'APPROVED' }); setApprovalReason(''); }}>
                          Approve
                        </Button>
                        <Button type="button" variant="danger" size="sm" className="text-xs"
                          onClick={() => { setApprovalModal({ requestId: req.id, action: 'REJECTED' }); setApprovalReason(''); }}>
                          Reject
                        </Button>
                        <Button type="button" variant="secondary" size="sm" className="text-xs"
                          onClick={() => { setApprovalModal({ requestId: req.id, action: 'QUERIED' }); setApprovalReason(''); }}>
                          Query
                        </Button>
                      </div>
                    )}
                    {req.status === 'APPROVED' && req.approvalReason && (
                      <span className="text-xs text-app-fg-muted italic truncate max-w-[150px] block">{req.approvalReason}</span>
                    )}
                    {req.status === 'REJECTED' && req.approvalReason && (
                      <span className="text-xs text-danger-500 dark:text-danger-400 italic truncate max-w-[150px] block">{req.approvalReason}</span>
                    )}
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr><td colSpan={6}><EmptyState title="No approval requests" /></td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <div className="md:hidden space-y-3 px-1">
          {paginated.map((req) => (
            <div key={req.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-app-hover text-app-fg-muted">
                  {APPROVAL_TYPE_LABELS[req.type] ?? req.type}
                </span>
                <StatusBadge status={req.status} />
              </div>
              <p className="text-sm text-app-fg-muted">{req.description}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-app-fg-muted">
                  {new Date(req.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                </span>
                <NairaPrice amount={Number(req.amount)} className="font-medium text-app-fg" />
              </div>
              {(req.status === 'PENDING' || req.status === 'QUERIED') && (
                <div className="flex gap-2 pt-1">
                  <Button type="button" variant="success" size="sm" className="text-xs flex-1"
                    onClick={() => { setApprovalModal({ requestId: req.id, action: 'APPROVED' }); setApprovalReason(''); }}>
                    Approve
                  </Button>
                  <Button type="button" variant="danger" size="sm" className="text-xs flex-1"
                    onClick={() => { setApprovalModal({ requestId: req.id, action: 'REJECTED' }); setApprovalReason(''); }}>
                    Reject
                  </Button>
                  <Button type="button" variant="secondary" size="sm" className="text-xs flex-1"
                    onClick={() => { setApprovalModal({ requestId: req.id, action: 'QUERIED' }); setApprovalReason(''); }}>
                    Query
                  </Button>
                </div>
              )}
            </div>
          ))}
          {paginated.length === 0 && (
            <EmptyState title="No approval requests" />
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-app-border">
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>
    </>
  );
}
