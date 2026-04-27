import { useState, useEffect, useRef } from 'react';
import { Link, useFetcher, useRevalidator, useNavigation, useSearchParams } from '@remix-run/react';
import { useFetcherToast, useToast } from '~/components/ui/toast';
import { createAdSpendLogFormSchema, updateAdSpendSchema } from '@yannis/shared/validators';
import { PageNotification } from '~/components/ui/page-notification';
import { HighCpaWarningBanner } from '~/features/marketing/HighCpaWarningBanner';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { FileUpload } from '~/components/ui/file-upload';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { Spinner } from '~/components/ui/spinner';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { PageHeader } from '~/components/ui/page-header';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { Pagination } from '~/components/ui/pagination';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { StatRow, StatRowGroup } from '~/components/ui/stat-row';
import { fetchAdSpendIntervalPreview } from '~/lib/trpc-browser';
import { useBranchScopeActionGuard } from '~/contexts/branch-scope-action-guard';
import type { FileUploadUploadState } from '~/components/ui/file-upload';
import type {
  AdSpendIntervalPreview,
  AdSpendRecord,
  Campaign,
  LeaderboardEntry,
  MarketingAdSpendLoaderData,
  Product,
  User,
} from './types';
import { AddExpenseModal } from './AddExpenseModal';
import { AdSpendDayAccordion } from './AdSpendDayAccordion';

const AD_SPEND_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All entries' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

function adSpendRowCanEdit(s: AdSpendRecord): boolean {
  const st = s.status ?? 'PENDING';
  return st === 'PENDING' || st === 'REJECTED';
}

const HIGH_CPA_THRESHOLD = 5000;

function hasPositiveSpendAmountInput(raw: string): boolean {
  const t = raw.replace(/,/g, '').trim();
  if (t === '') return false;
  const n = Number(t);
  return !Number.isNaN(n) && n > 0;
}

export function MarketingAdSpendPage({
  adSpend,
  totalAdSpend: _totalRowCount,
  page,
  totalPages,
  statusFilter,
  searchFilter,
  productIdFilter,
  statusCounts,
  metrics,
  leaderboard,
  users,
  products,
  campaigns,
  filters,
  viewMode = 'admin',
  groups,
  groupsPage,
  groupsTotalPages,
}: MarketingAdSpendLoaderData) {
  const dateFilters = filters;
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();
  const { toast } = useToast();
  const { ensureBranchForAction, requiresBranchSelection } = useBranchScopeActionGuard();
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';
  const [selectedStatus, setSelectedStatus] = useState(statusFilter || 'ALL');
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');
  const [selectedProductId, setSelectedProductId] = useState(productIdFilter || 'ALL');
  const [showAdSpendForm, setShowAdSpendForm] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showLegacyTable, setShowLegacyTable] = useState(false);
  const [adSpendDetailModal, setAdSpendDetailModal] = useState<AdSpendRecord | null>(null);
  const [rejectStep, setRejectStep] = useState(false);
  const [editTarget, setEditTarget] = useState<AdSpendRecord | null>(null);
  const [editFormCampaignId, setEditFormCampaignId] = useState('');
  const [editFormProductId, setEditFormProductId] = useState('');
  const [editFormSpendDate, setEditFormSpendDate] = useState('');
  const [editFormSpendAmount, setEditFormSpendAmount] = useState('');
  const [editScreenshotUrl, setEditScreenshotUrl] = useState('');
  const [editFileUploadState, setEditFileUploadState] = useState<FileUploadUploadState>('idle');
  const [dismissedError, setDismissedError] = useState(false);

  const [formCampaignId, setFormCampaignId] = useState('');
  const [formProductId, setFormProductId] = useState('');
  const [formSpendDate, setFormSpendDate] = useState('');
  const [formSpendAmount, setFormSpendAmount] = useState('');
  const [adSpendPreview, setAdSpendPreview] = useState<AdSpendIntervalPreview | null>(null);
  const [adSpendPreviewLoading, setAdSpendPreviewLoading] = useState(false);
  const adSpendPreviewGen = useRef(0);
  const [adSpendScreenshotUrl, setAdSpendScreenshotUrl] = useState('');
  const [adSpendFileUploadState, setAdSpendFileUploadState] = useState<FileUploadUploadState>('idle');

  useEffect(() => {
    setSelectedStatus(statusFilter || 'ALL');
    setSearchQuery(searchFilter || '');
    setSelectedProductId(productIdFilter || 'ALL');
  }, [statusFilter, searchFilter, productIdFilter]);

  useEffect(() => {
    if (!showAdSpendForm) {
      setFormCampaignId('');
      setFormProductId('');
      setFormSpendDate('');
      setFormSpendAmount('');
      setAdSpendScreenshotUrl('');
      setAdSpendFileUploadState('idle');
      setAdSpendPreview(null);
      setAdSpendPreviewLoading(false);
      return;
    }
    setFormSpendDate((prev) => {
      if (prev) return prev;
      const t = new Date();
      const y = t.getFullYear();
      const m = String(t.getMonth() + 1).padStart(2, '0');
      const d = String(t.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    });
  }, [showAdSpendForm]);

  useEffect(() => {
    if (!showAdSpendForm || !formCampaignId || !formProductId || !formSpendDate) {
      setAdSpendPreview(null);
      setAdSpendPreviewLoading(false);
      return;
    }
    const rawAmt = formSpendAmount.replace(/,/g, '').trim();
    const spendNum = rawAmt === '' ? undefined : Number(rawAmt);
    const spendAmount =
      spendNum !== undefined && !Number.isNaN(spendNum) && spendNum > 0 ? spendNum : undefined;

    const gen = ++adSpendPreviewGen.current;
    const handle = window.setTimeout(() => {
      setAdSpendPreviewLoading(true);
      void fetchAdSpendIntervalPreview({
        campaignId: formCampaignId,
        productId: formProductId,
        spendDate: formSpendDate,
        spendAmount,
      })
        .then((res) => {
          if (adSpendPreviewGen.current !== gen) return;
          setAdSpendPreview(res);
        })
        .catch(() => {
          if (adSpendPreviewGen.current !== gen) return;
          setAdSpendPreview(null);
        })
        .finally(() => {
          if (adSpendPreviewGen.current !== gen) return;
          setAdSpendPreviewLoading(false);
        });
    }, 350);

    return () => {
      window.clearTimeout(handle);
      setAdSpendPreviewLoading(false);
    };
  }, [showAdSpendForm, formCampaignId, formProductId, formSpendDate, formSpendAmount]);

  const getListParams = (overrides: { page?: number; status?: string; search?: string; productId?: string }) => {
    const params = new URLSearchParams(searchParams);
    if (overrides.page !== undefined) params.set('page', String(overrides.page));
    if (overrides.status !== undefined) {
      if (overrides.status === 'ALL' || !overrides.status) params.delete('status');
      else params.set('status', overrides.status);
    }
    if (overrides.search !== undefined) {
      if (overrides.search) params.set('search', overrides.search);
      else params.delete('search');
    }
    if (overrides.productId !== undefined) {
      if (overrides.productId === 'ALL' || !overrides.productId) params.delete('productId');
      else params.set('productId', overrides.productId);
    }
    return params;
  };

  const buildListQueryString = (overrides: Parameters<typeof getListParams>[0]) => {
    const qs = getListParams(overrides).toString();
    return qs ? `?${qs}` : '?';
  };

  const handleAdSpendStatusChange = (status: string) => {
    setSelectedStatus(status);
    setSearchParams(getListParams({ status: status === 'ALL' ? 'ALL' : status, page: 1 }));
  };

  /** Switching the product filter resets to page 1 — the new filtered set has different rows. */
  const handleAdSpendProductChange = (productId: string) => {
    setSelectedProductId(productId);
    setSearchParams(getListParams({ productId, page: 1 }));
  };

  const handleAdSpendSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams(getListParams({ search: searchQuery.trim() || undefined, page: 1 }));
  };

  const handleLogAdSpendSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const spendRaw = formSpendAmount.replace(/,/g, '').trim();
    const parsed = createAdSpendLogFormSchema.safeParse({
      campaignId: formCampaignId,
      productId: formProductId,
      spendAmount: spendRaw,
      spendDate: formSpendDate,
      screenshotUrl: adSpendScreenshotUrl.trim(),
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message ?? 'Check the form and try again.';
      toast.error('Cannot log ad spend', first);
      return;
    }
    const fd = new FormData(e.currentTarget);
    fd.set('screenshotUrl', parsed.data.screenshotUrl);
    fd.set('spendAmount', spendRaw);
    ensureBranchForAction({
      actionLabel: 'logging ad spend',
      onProceed: () => fetcher.submit(fd, { method: 'post' }),
    });
  };

  const handleEditAdSpendSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editTarget) return;
    const spendRaw = editFormSpendAmount.replace(/,/g, '').trim();
    const parsed = updateAdSpendSchema.safeParse({
      adSpendId: editTarget.id,
      campaignId: editFormCampaignId,
      productId: editFormProductId,
      spendAmount: spendRaw,
      spendDate: editFormSpendDate,
      screenshotUrl: editScreenshotUrl.trim(),
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message ?? 'Check the form and try again.';
      toast.error('Cannot update ad spend', first);
      return;
    }
    const fd = new FormData(e.currentTarget);
    fd.set('adSpendId', parsed.data.adSpendId);
    fd.set('screenshotUrl', parsed.data.screenshotUrl);
    fd.set('spendAmount', spendRaw);
    fd.set('spendDate', parsed.data.spendDate);
    fd.set('campaignId', editFormCampaignId);
    fd.set('productId', editFormProductId);
    ensureBranchForAction({
      actionLabel: 'updating ad spend',
      onProceed: () => fetcher.submit(fd, { method: 'post' }),
    });
  };

  const adSpendLogSubmitDisabled =
    adSpendFileUploadState === 'uploading' ||
    !formCampaignId ||
    !formProductId ||
    !formSpendDate.trim() ||
    !hasPositiveSpendAmountInput(formSpendAmount) ||
    !adSpendScreenshotUrl.trim();

  const editAdSpendSubmitDisabled =
    editFileUploadState === 'uploading' ||
    !editFormCampaignId ||
    !editFormProductId ||
    !editFormSpendDate.trim() ||
    !hasPositiveSpendAmountInput(editFormSpendAmount) ||
    !editScreenshotUrl.trim();

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const actionSuccess = (fetcher.data as { success?: boolean } | undefined)?.success;
  useFetcherToast(fetcher.data, { successMessage: 'Action completed' });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);
  useEffect(() => {
    if (!actionError) return;
    if (!requiresBranchSelection) return;
    if (!actionError.toLowerCase().includes('branch context required')) return;
    ensureBranchForAction({ actionLabel: 'this ad spend action' });
  }, [actionError, requiresBranchSelection, ensureBranchForAction]);

  useEffect(() => {
    if (actionSuccess && showAdSpendForm) setShowAdSpendForm(false);
  }, [actionSuccess, showAdSpendForm]);

  useEffect(() => {
    if (actionSuccess && adSpendDetailModal) {
      setAdSpendDetailModal(null);
      setRejectStep(false);
    }
  }, [actionSuccess, adSpendDetailModal]);

  useEffect(() => {
    if (actionSuccess && editTarget) {
      setEditTarget(null);
    }
  }, [actionSuccess, editTarget]);

  useEffect(() => {
    if (!editTarget) return;
    setEditFormCampaignId(editTarget.campaignId);
    setEditFormProductId(editTarget.productId);
    const d = editTarget.spendDate;
    setEditFormSpendDate(typeof d === 'string' && d.length >= 10 ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));
    setEditFormSpendAmount(String(Number(editTarget.spendAmount)));
    setEditScreenshotUrl(editTarget.screenshotUrl);
    setEditFileUploadState('idle');
  }, [editTarget]);

  useEffect(() => {
    if (actionSuccess && revalidator.state === 'idle') {
      revalidator.revalidate();
    }
  }, [actionSuccess, revalidator.state, revalidator]);

  const getProductName = (productId: string, resolvedProducts: Product[]): string =>
    resolvedProducts.find((p) => p.id === productId)?.name ?? 'Unknown product';
  const getCampaignName = (campaignId: string): string =>
    campaigns.find((c: Campaign) => c.id === campaignId)?.name ?? 'Unknown campaign';
  const getUserName = (userId: string, resolvedUsers: User[]): string =>
    resolvedUsers.find((u) => u.id === userId)?.name ?? 'Unknown user';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ad spend"
        description={
          <>
            Log daily spend with Ads Manager screenshots.{' '}
            <Link
              to="/admin/marketing/funding"
              className="text-brand-600 dark:text-brand-400 font-medium hover:underline"
            >
              Funding &amp; performance
            </Link>
          </>
        }
        actions={
          <>
            <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
              <DateFilterBar
                startDate={dateFilters.startDate}
                endDate={dateFilters.endDate}
                periodAllTime={dateFilters.periodAllTime}
              />
            </div>
            {isFilterLoading && (
              <span className="flex items-center text-app-fg-muted" aria-hidden>
                <Spinner size="sm" className="shrink-0" />
              </span>
            )}
            <Button variant="primary" size="sm" onClick={() => setShowAddExpense(true)}>
              + Add Expense
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

      <DeferredSection resolve={metrics} fallback={<OverviewStatStripSkeleton count={4} />}>
        {(m) => (
          <OverviewStatStrip
            items={[
              {
                label: 'Total spend',
                value: <>{'\u20A6'}{Math.round(m.totalSpend).toLocaleString()}</>,
                valueClassName: 'text-app-fg',
                title: `${m.totalOrders} orders, ${m.deliveredOrders} delivered`,
              },
              {
                label: 'CPA',
                value: <>{'\u20A6'}{Math.round(m.cpa).toLocaleString()}</>,
                valueClassName: 'text-app-fg',
                title: 'Spend / all orders',
              },
              {
                label: 'True ROAS',
                value: <>{m.trueRoas.toFixed(2)}x</>,
                valueClassName: 'text-brand-600 dark:text-brand-400',
                title: 'Delivered revenue / spend',
              },
            ]}
          />
        )}
      </DeferredSection>

      <DeferredSection resolve={leaderboard} skeleton="inline">
        {(lb) => {
          const highCpaBuyers = lb.filter((b: LeaderboardEntry) => b.cpa > HIGH_CPA_THRESHOLD && b.totalOrders > 0);
          return viewMode !== 'media_buyer' ? (
            <HighCpaWarningBanner
              buyers={highCpaBuyers.map((b: LeaderboardEntry) => ({ mediaBuyerId: b.mediaBuyerId, name: b.name, cpa: b.cpa }))}
              threshold={HIGH_CPA_THRESHOLD}
            />
          ) : null;
        }}
      </DeferredSection>

      <ResponsiveFormPanel open={showAdSpendForm} onClose={() => setShowAdSpendForm(false)}>
        <fetcher.Form method="post" className="card space-y-3" onSubmit={handleLogAdSpendSubmit} noValidate>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-app-fg">Log Ad Spend</h3>
            <button type="button" onClick={() => setShowAdSpendForm(false)} className="text-app-fg-muted hover:text-app-fg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <input type="hidden" name="intent" value="createAdSpend" />
          <input type="hidden" name="campaignId" value={formCampaignId} />
          <input type="hidden" name="productId" value={formProductId} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <SearchableSelect
                id="marketing-adspend-create-campaign"
                label="Campaign"
                placeholder="Select campaign..."
                required
                value={formCampaignId}
                onChange={setFormCampaignId}
                searchPlaceholder="Search campaigns..."
                options={campaigns
                  .filter((c: Campaign) => c.status === 'ACTIVE')
                  .map((c: Campaign) => ({ value: c.id, label: c.name }))}
              />
            </div>
            <div>
              <DeferredSection resolve={products} skeleton="inline">
                {(resolvedProducts: Product[]) => (
                  <SearchableSelect
                    id="marketing-adspend-create-product"
                    label="Product"
                    placeholder="Select product..."
                    required
                    value={formProductId}
                    onChange={setFormProductId}
                    searchPlaceholder="Search products..."
                    options={resolvedProducts.map((p: Product) => ({ value: p.id, label: p.name }))}
                  />
                )}
              </DeferredSection>
            </div>
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">Spend Amount ({'\u20A6'})</label>
              <AmountInput
                name="spendAmount"
                required
                placeholder="e.g. 15,000.00"
                className="input"
                value={formSpendAmount}
                onChange={(raw) => setFormSpendAmount(raw)}
              />
            </div>
            <div>
              <TextInput
                label="Spend Date"
                name="spendDate"
                type="date"
                required
                value={formSpendDate}
                onChange={(e) => setFormSpendDate(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <FileUpload
                folder={S3_FOLDERS.SCREENSHOTS}
                name="screenshotUrl"
                label="Ads Manager Screenshot"
                required
                onUpload={(url) => setAdSpendScreenshotUrl(url)}
                onUploadStateChange={setAdSpendFileUploadState}
              />
              <p className="text-xs text-app-fg-muted mt-1">Mandatory — no screenshot, no log entry accepted</p>
            </div>
          </div>

          {formCampaignId && formProductId && formSpendDate && (
            <div className="rounded-lg border border-app-border bg-app-hover/50 p-3 space-y-2">
              <p className="text-xs text-app-fg-muted leading-relaxed">
                Orders since your last <span className="font-medium text-app-fg">approved</span> ad spend for this
                campaign and product (all order statuses). This is not the same window as the period strip CPA above.
              </p>
              {adSpendPreviewLoading ? (
                <div className="flex items-center gap-2 text-sm text-app-fg-muted py-1">
                  <Spinner size="sm" className="shrink-0" />
                  <span>Calculating…</span>
                </div>
              ) : adSpendPreview ? (
                <>
                  <StatRowGroup divided>
                    <StatRow label="Orders in window" value={adSpendPreview.orderCount.toLocaleString()} />
                    {adSpendPreview.indicativeCpa != null ? (
                      <StatRow label="Indicative CPA" value="" amount={adSpendPreview.indicativeCpa} />
                    ) : (
                      <StatRow
                        label="Indicative CPA"
                        value={
                          adSpendPreview.orderCount === 0 ? '— (no orders yet)' : '— (enter spend amount)'
                        }
                      />
                    )}
                  </StatRowGroup>
                  <p className="text-2xs text-app-fg-muted pt-0.5">
                    {adSpendPreview.priorSpendDate ? (
                      <>
                        Last approved spend date:{' '}
                        {new Date(adSpendPreview.priorSpendDate + 'T12:00:00.000Z').toLocaleDateString('en-NG', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                        {adSpendPreview.windowStartExclusive
                          ? ` · Counting orders after ${new Date(adSpendPreview.windowStartExclusive).toLocaleString('en-NG', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}`
                          : null}
                        .
                      </>
                    ) : (
                      <>
                        No approved spend on an earlier calendar day for this funnel — counting all of your orders for
                        this campaign and product through now.
                      </>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-xs text-app-fg-muted">Preview unavailable. Check campaign and try again.</p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={fetcher.state === 'submitting'}
              loadingText="Logging..."
              disabled={adSpendLogSubmitDisabled}
            >
              Log Ad Spend
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowAdSpendForm(false)}>
              Cancel
            </Button>
          </div>
        </fetcher.Form>
      </ResponsiveFormPanel>

      <ResponsiveFormPanel open={!!editTarget} onClose={() => setEditTarget(null)}>
        {editTarget ? (
          <fetcher.Form
            key={editTarget.id}
            method="post"
            className="card space-y-3"
            onSubmit={handleEditAdSpendSubmit}
            noValidate
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-app-fg">Edit ad spend</h3>
              <button type="button" onClick={() => setEditTarget(null)} className="text-app-fg-muted hover:text-app-fg">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <input type="hidden" name="intent" value="updateAdSpend" />
            <input type="hidden" name="adSpendId" value={editTarget.id} />
            <input type="hidden" name="screenshotUrl" value={editScreenshotUrl} />
            <input type="hidden" name="campaignId" value={editFormCampaignId} />
            <input type="hidden" name="productId" value={editFormProductId} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <SearchableSelect
                  id="marketing-adspend-edit-campaign"
                  label="Campaign"
                  placeholder="Select campaign..."
                  required
                  value={editFormCampaignId}
                  onChange={setEditFormCampaignId}
                  searchPlaceholder="Search campaigns..."
                  options={campaigns
                    .filter((c: Campaign) => c.status === 'ACTIVE')
                    .map((c: Campaign) => ({ value: c.id, label: c.name }))}
                />
              </div>
              <div>
                <DeferredSection resolve={products} skeleton="inline">
                  {(resolvedProducts: Product[]) => (
                    <SearchableSelect
                      id="marketing-adspend-edit-product"
                      label="Product"
                      placeholder="Select product..."
                      required
                      value={editFormProductId}
                      onChange={setEditFormProductId}
                      searchPlaceholder="Search products..."
                      options={resolvedProducts.map((p: Product) => ({ value: p.id, label: p.name }))}
                    />
                  )}
                </DeferredSection>
              </div>
              <div>
                <label className="block text-sm font-medium text-app-fg-muted mb-1">Spend Amount ({'\u20A6'})</label>
                <AmountInput
                  name="spendAmount"
                  required
                  placeholder="e.g. 15,000.00"
                  className="input"
                  value={editFormSpendAmount}
                  onChange={(raw) => setEditFormSpendAmount(raw)}
                />
              </div>
              <div>
                <TextInput
                  label="Spend Date"
                  name="spendDate"
                  type="date"
                  required
                  value={editFormSpendDate}
                  onChange={(e) => setEditFormSpendDate(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <FileUpload
                  folder={S3_FOLDERS.SCREENSHOTS}
                  label="Ads Manager Screenshot"
                  required
                  onUpload={(url) => setEditScreenshotUrl(url)}
                  onUploadStateChange={setEditFileUploadState}
                />
                <p className="text-xs text-app-fg-muted mt-1">
                  Current file is kept unless you upload a replacement (mandatory URL on save).
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={
                  fetcher.state === 'submitting' &&
                  fetcher.formData?.get('intent') === 'updateAdSpend' &&
                  fetcher.formData?.get('adSpendId') === editTarget.id
                }
                loadingText="Saving..."
                disabled={editAdSpendSubmitDisabled}
              >
                Save changes
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditTarget(null)}>
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        ) : null}
      </ResponsiveFormPanel>

      {/* Phase 17: Daily groups accordion — primary view. */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-app-border flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-app-fg">Daily expenses</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowLegacyTable((v) => !v)}
          >
            {showLegacyTable ? 'Hide detailed view' : 'Detailed view'}
          </Button>
        </div>
        <div className="p-4">
          <AdSpendDayAccordion
            groups={groups}
            showMediaBuyerColumn={viewMode !== 'media_buyer'}
            canModerate={viewMode !== 'media_buyer'}
            page={groupsPage}
            totalPages={groupsTotalPages}
            actionUrl="/admin/marketing/ad-spend"
          />
        </div>
      </div>

      {showLegacyTable && (
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-app-border">
          <h2 className="text-lg font-semibold text-app-fg">Detailed view (per-line)</h2>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-stretch sm:items-center px-4 py-3 border-b border-app-border">
          <form onSubmit={handleAdSpendSearchSubmit} className="flex gap-2 flex-1 min-w-0">
            <SearchInput
              value={searchQuery}
              onChange={(val) => setSearchQuery(val)}
              placeholder="Search by media buyer, product, campaign, or entry ID..."
              wrapperClassName="flex-1 min-w-0"
            />
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
          </form>
          <FormSelect
            value={selectedStatus}
            onChange={(e) => handleAdSpendStatusChange(e.target.value)}
            options={AD_SPEND_STATUS_OPTIONS.map((opt) => ({
              value: opt.value,
              label: `${opt.label}${
                opt.value === 'ALL'
                  ? ` (${statusCounts.ALL})`
                  : opt.value === 'PENDING'
                    ? ` (${statusCounts.PENDING})`
                    : opt.value === 'APPROVED'
                      ? ` (${statusCounts.APPROVED})`
                      : opt.value === 'REJECTED'
                        ? ` (${statusCounts.REJECTED})`
                        : ''
              }`,
            }))}
            wrapperClassName="w-auto min-w-[11rem]"
          />
          {/* Product filter — narrows the list to spend on a single product. Useful for HoM
              auditing per-product CPA / ROAS, or for an MB scoping their own log down to one
              campaign's product. Loaded from the same `products` array used by the create form,
              so for media buyers it's already pre-scoped to their assigned products. */}
          <SearchableSelect
            id="marketing-adspend-product-filter"
            value={selectedProductId}
            onChange={handleAdSpendProductChange}
            options={[
              { value: 'ALL', label: 'All products' },
              ...products.map((p: Product) => ({ value: p.id, label: p.name })),
            ]}
            wrapperClassName="w-auto min-w-[12rem]"
            searchPlaceholder="Search products..."
          />
          {isFilterLoading && (
            <span className="flex items-center text-app-fg-muted" aria-hidden>
              <Spinner size="sm" className="shrink-0" />
            </span>
          )}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Date</th>
                {viewMode !== 'media_buyer' && <th className="table-header">Media Buyer</th>}
                <th className="table-header text-right">Amount</th>
                <th className="table-header">Product</th>
                <th className="table-header">Campaign</th>
                <th className="table-header text-right">Orders</th>
                <th className="table-header text-right">CPA</th>
                <th className="table-header">Status</th>
                <th className="table-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {adSpend.map((s: AdSpendRecord) => (
                <tr key={s.id} className="table-row">
                  <td className="table-cell text-app-fg-muted">
                    {new Date(s.spendDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  {viewMode !== 'media_buyer' && (
                    <td className="table-cell text-sm text-app-fg">
                      <DeferredSection resolve={users} skeleton="inline">
                        {(resolvedUsers: User[]) => <>{getUserName(s.mediaBuyerId, resolvedUsers)}</>}
                      </DeferredSection>
                    </td>
                  )}
                  <td className="table-cell text-right font-medium"><NairaPrice amount={Number(s.spendAmount)} /></td>
                  <td className="table-cell text-sm text-app-fg-muted">
                    {s.productId ? (
                      <DeferredSection resolve={products} skeleton="inline">
                        {(resolvedProducts: Product[]) => (
                          <Link
                            to={`/admin/products/${s.productId}`}
                            className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
                          >
                            {getProductName(s.productId, resolvedProducts)}
                          </Link>
                        )}
                      </DeferredSection>
                    ) : (
                      '\u2014'
                    )}
                  </td>
                  <td className="table-cell text-sm text-app-fg-muted">
                    {s.campaignId ? (
                      <Link
                        to={`/admin/marketing/forms?search=${encodeURIComponent(getCampaignName(s.campaignId))}`}
                        className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
                      >
                        {getCampaignName(s.campaignId)}
                      </Link>
                    ) : '\u2014'}
                  </td>
                  <td className="table-cell text-right text-sm text-app-fg-muted">
                    {(s.orderCount ?? 0).toLocaleString()}
                  </td>
                  <td className="table-cell text-right text-sm">
                    {s.indicativeCpa != null ? (
                      <NairaPrice amount={s.indicativeCpa} />
                    ) : (
                      <span className="text-app-fg-muted">{'\u2014'}</span>
                    )}
                  </td>
                  <td className="table-cell">
                    <StatusBadge status={s.status ?? 'PENDING'} />
                  </td>
                  <td className="table-cell">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setAdSpendDetailModal(s);
                          setRejectStep(false);
                        }}
                      >
                        Preview
                      </Button>
                      {adSpendRowCanEdit(s) && (
                        <Button type="button" variant="secondary" size="sm" onClick={() => setEditTarget(s)}>
                          Edit
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {adSpend.length === 0 && (
                <tr>
                  <td colSpan={viewMode !== 'media_buyer' ? 9 : 8}>
                    <EmptyState title="No ad spend records yet" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden space-y-3 px-1 py-3">
          {adSpend.map((s: AdSpendRecord) => (
            <div key={s.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-app-fg"><NairaPrice amount={Number(s.spendAmount)} /></span>
                <StatusBadge status={s.status ?? 'PENDING'} />
              </div>
              <p className="text-sm text-app-fg-muted">
                <DeferredSection resolve={users} skeleton="inline">
                  {(resolvedUsers: User[]) => (
                    <>
                      {getUserName(s.mediaBuyerId, resolvedUsers)}
                      {' \u2014 '}
                      {new Date(s.spendDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </>
                  )}
                </DeferredSection>
              </p>
              <p className="text-xs text-app-fg-muted">
                <DeferredSection resolve={products} skeleton="inline">
                  {(resolvedProducts: Product[]) => (
                    <>
                      Product:{' '}
                      {s.productId ? (
                        <Link
                          to={`/admin/products/${s.productId}`}
                          className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
                        >
                          {getProductName(s.productId, resolvedProducts)}
                        </Link>
                      ) : (
                        '\u2014'
                      )}
                      {' \u00b7 '}
                      Campaign:{' '}
                      {s.campaignId ? (
                        <Link
                          to={`/admin/marketing/forms?search=${encodeURIComponent(getCampaignName(s.campaignId))}`}
                          className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
                        >
                          {getCampaignName(s.campaignId)}
                        </Link>
                      ) : (
                        '\u2014'
                      )}
                    </>
                  )}
                </DeferredSection>
              </p>
              <p className="text-xs text-app-fg-muted">
                Orders in window: {(s.orderCount ?? 0).toLocaleString()}
                {' \u00b7 '}
                Indicative CPA:{' '}
                {s.indicativeCpa != null ? (
                  <NairaPrice amount={s.indicativeCpa} />
                ) : (
                  '\u2014'
                )}
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setAdSpendDetailModal(s);
                    setRejectStep(false);
                  }}
                >
                  Preview
                </Button>
                {adSpendRowCanEdit(s) && (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setEditTarget(s)}>
                    Edit
                  </Button>
                )}
              </div>
            </div>
          ))}
          {adSpend.length === 0 && <EmptyState title="No ad spend records" />}
        </div>

        {totalPages > 1 && (
          <div className="border-t border-app-border px-4 py-3">
            <Pagination page={page} totalPages={totalPages} pageParam="page" />
          </div>
        )}
      </div>
      )}

      <AddExpenseModal
        open={showAddExpense}
        onClose={() => setShowAddExpense(false)}
        campaigns={campaigns}
        products={products}
        actionUrl="/admin/marketing/ad-spend"
        onSuccess={() => revalidator.revalidate()}
      />

      {adSpendDetailModal?.screenshotUrl && (
        <Modal
          open
          onClose={() => setAdSpendDetailModal(null)}
          maxWidth="max-w-lg"
          role="dialog"
          contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]"
        >
          <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <h3 className="text-lg font-semibold text-app-fg">Ad spend</h3>
            <button type="button" onClick={() => setAdSpendDetailModal(null)} className="text-app-fg-muted hover:text-app-fg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5">
            <div className="rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 p-4 space-y-3">
              <div>
                <p className="text-xs font-medium text-brand-600 dark:text-brand-400 uppercase tracking-wider">Amount</p>
                <p className="text-2xl font-bold text-brand-700 dark:text-brand-300 mt-1">
                  <NairaPrice amount={Number(adSpendDetailModal.spendAmount)} />
                </p>
              </div>
              <p className="text-sm text-brand-600 dark:text-brand-400">
                Spend date:{' '}
                {new Date(adSpendDetailModal.spendDate).toLocaleDateString('en-NG', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
              <DeferredSection resolve={users} skeleton="inline">
                {(resolvedUsers: User[]) => (
                  <p className="text-xs text-brand-500 dark:text-brand-400">
                    Media buyer: {getUserName(adSpendDetailModal.mediaBuyerId, resolvedUsers)}
                    {adSpendDetailModal.status === 'APPROVED' && adSpendDetailModal.approvedBy && (
                      <>
                        {' · '}
                        Approved by:{' '}
                        {getUserName(adSpendDetailModal.approvedBy, resolvedUsers)}
                      </>
                    )}
                  </p>
                )}
              </DeferredSection>
              <DeferredSection resolve={products} skeleton="inline">
                {(resolvedProducts: Product[]) => (
                  <p className="text-xs text-brand-500 dark:text-brand-400">
                    Product:{' '}
                    {adSpendDetailModal.productId
                      ? getProductName(adSpendDetailModal.productId, resolvedProducts)
                      : '\u2014'}
                    {' · '}
                    Campaign:{' '}
                    {adSpendDetailModal.campaignId
                      ? getCampaignName(adSpendDetailModal.campaignId)
                      : '\u2014'}
                  </p>
                )}
              </DeferredSection>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={adSpendDetailModal.status ?? 'PENDING'} />
                {adSpendDetailModal.status === 'APPROVED' && adSpendDetailModal.approvedAt && (
                  <span className="text-xs text-brand-500 dark:text-brand-400">
                    {new Date(adSpendDetailModal.approvedAt).toLocaleDateString('en-NG', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-app-border bg-app-hover/50 p-3">
              <p className="text-xs text-app-fg-muted mb-2">Orders and indicative CPA use the same window as Log Ad Spend.</p>
              <StatRowGroup divided>
                <StatRow label="Orders in window" value={(adSpendDetailModal.orderCount ?? 0).toLocaleString()} />
                {adSpendDetailModal.indicativeCpa != null ? (
                  <StatRow label="Indicative CPA" value="" amount={adSpendDetailModal.indicativeCpa} />
                ) : (
                  <StatRow
                    label="Indicative CPA"
                    value={
                      (adSpendDetailModal.orderCount ?? 0) === 0 ? '— (no orders yet)' : '— (enter spend amount)'
                    }
                  />
                )}
              </StatRowGroup>
            </div>
            {adSpendDetailModal.status === 'REJECTED' && (
              <div className="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50/80 dark:bg-danger-900/20 p-3 text-sm space-y-1">
                <p className="font-medium text-danger-800 dark:text-danger-200">Rejected</p>
                {adSpendDetailModal.rejectionReason ? (
                  <p className="text-app-fg">{adSpendDetailModal.rejectionReason}</p>
                ) : null}
                <DeferredSection resolve={users} skeleton="inline">
                  {(resolvedUsers: User[]) => (
                    <p className="text-xs text-app-fg-muted">
                      {adSpendDetailModal.rejectedAt
                        ? new Date(adSpendDetailModal.rejectedAt).toLocaleString('en-NG', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : null}
                      {adSpendDetailModal.rejectedBy ? (
                        <>
                          {' · '}
                          By{' '}
                          {getUserName(adSpendDetailModal.rejectedBy, resolvedUsers)}
                        </>
                      ) : null}
                    </p>
                  )}
                </DeferredSection>
              </div>
            )}
            <div className="rounded-lg border border-app-border overflow-hidden bg-app-hover">
              <img
                src={adSpendDetailModal.screenshotUrl}
                alt="Ads Manager screenshot"
                className="w-full max-h-[400px] object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  const fallback = (e.target as HTMLImageElement).nextElementSibling;
                  if (fallback) (fallback as HTMLElement).style.display = 'flex';
                }}
              />
              <div className="items-center justify-center gap-2 p-8 hidden">
                <span className="text-sm text-app-fg-muted">Screenshot could not be loaded</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 pt-3 border-t border-app-border shrink-0 px-4 sm:px-5 pb-4">
            {viewMode !== 'media_buyer' && adSpendDetailModal.status === 'PENDING' && !rejectStep && (
              <div className="flex flex-wrap items-center gap-2">
                <fetcher.Form method="post" className="inline">
                  <input type="hidden" name="intent" value="approveAdSpend" />
                  <input type="hidden" name="adSpendId" value={adSpendDetailModal.id} />
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={
                      fetcher.state === 'submitting' &&
                      fetcher.formData?.get('intent') === 'approveAdSpend' &&
                      fetcher.formData?.get('adSpendId') === adSpendDetailModal.id
                    }
                    disabled={fetcher.state !== 'idle'}
                  >
                    Approve
                  </Button>
                </fetcher.Form>
                <Button type="button" variant="secondary" size="sm" onClick={() => setRejectStep(true)}>
                  Reject
                </Button>
              </div>
            )}
            {viewMode !== 'media_buyer' && adSpendDetailModal.status === 'PENDING' && rejectStep && (
              <fetcher.Form method="post" className="space-y-2 max-w-lg">
                <input type="hidden" name="intent" value="rejectAdSpend" />
                <input type="hidden" name="adSpendId" value={adSpendDetailModal.id} />
                <Textarea
                  label="Reason (optional)"
                  name="reason"
                  rows={3}
                  maxLength={500}
                  placeholder="Optional note for the media buyer"
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setRejectStep(false)}>
                    Back
                  </Button>
                  <Button
                    type="submit"
                    variant="danger"
                    size="sm"
                    loading={
                      fetcher.state === 'submitting' &&
                      fetcher.formData?.get('intent') === 'rejectAdSpend' &&
                      fetcher.formData?.get('adSpendId') === adSpendDetailModal.id
                    }
                    disabled={fetcher.state !== 'idle'}
                  >
                    Confirm reject
                  </Button>
                </div>
              </fetcher.Form>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {adSpendRowCanEdit(adSpendDetailModal) && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const r = adSpendDetailModal;
                    setAdSpendDetailModal(null);
                    setRejectStep(false);
                    setEditTarget(r);
                  }}
                >
                  Edit entry
                </Button>
              )}
              <a
                href={adSpendDetailModal.screenshotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary btn-sm inline-flex items-center gap-1.5"
              >
                Open in new tab
              </a>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setAdSpendDetailModal(null);
                  setRejectStep(false);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
