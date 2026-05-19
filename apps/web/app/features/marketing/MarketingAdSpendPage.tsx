import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { BranchScopedLink } from '~/components/ui/branch-scoped-link';
import { useFetcherToast, useToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface, ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import { createAdSpendLogFormSchema, updateAdSpendSchema } from '@yannis/shared/validators';
import { PageNotification } from '~/components/ui/page-notification';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { FileUpload } from '~/components/ui/file-upload';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { Spinner } from '~/components/ui/spinner';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { ASSET_FOLDERS } from '~/lib/object-storage';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { SearchInput } from '~/components/ui/search-input';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { Tabs } from '~/components/ui/tabs';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { Pagination } from '~/components/ui/pagination';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { Textarea } from '~/components/ui/textarea';
import { StatRow, StatRowGroup } from '~/components/ui/stat-row';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { fetchAdSpendIntervalPreview } from '~/lib/trpc-browser';
import { useBranchScopeActionGuard } from '~/contexts/branch-scope-action-guard';
import type { FileUploadUploadState } from '~/components/ui/file-upload';
import type {
  AdPlatform,
  AdSpendIntervalPreview,
  AdSpendRecord,
  AdSpendGroupLine,
  AdSpendStatusCounts,
  Campaign,
  MarketingAdSpendLoaderData,
  Product,
  User,
} from './types';
import { AD_EXPENSE_PLATFORM_OPTIONS } from './ad-expense-options';
import { AdSpendDayAccordion } from './AdSpendDayAccordion';

type SecondaryOk = {
  ok: true;
  metrics: NonNullable<MarketingAdSpendLoaderData['metrics']>;
  users: NonNullable<MarketingAdSpendLoaderData['users']>;
  products: NonNullable<MarketingAdSpendLoaderData['products']>;
  groups: NonNullable<MarketingAdSpendLoaderData['groups']>;
  groupsTotal: number;
  groupsPage: number;
  groupsTotalPages: number;
};
type SecondaryErr = {
  ok: false;
  error: string;
} & Omit<SecondaryOk, 'ok'>;
type SecondaryResponse = SecondaryOk | SecondaryErr;

type AdSpendDetailRecord = AdSpendRecord & {
  mediaBuyerName?: string | null;
};

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

function InlineLoadingText({ label = 'Loading…' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-app-fg-muted">
      <Spinner className="w-3.5 h-3.5" />
      <span>{label}</span>
    </span>
  );
}

function ExpenseViewToggle({
  value,
  onChange,
  fullWidth = false,
}: {
  value: 'daily' | 'detailed';
  onChange: (next: 'daily' | 'detailed') => void;
  fullWidth?: boolean;
}) {
  const shellClass = fullWidth
    ? 'flex w-full overflow-hidden rounded-md border border-app-border'
    : 'inline-flex overflow-hidden rounded-md border border-app-border';
  const buttonBase = 'px-3 py-1 text-xs font-medium transition-colors';

  return (
    <div role="tablist" aria-label="Expense view mode" className={shellClass}>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'daily'}
        onClick={() => onChange('daily')}
        className={[
          buttonBase,
          fullWidth ? 'flex-1 text-center' : '',
          value === 'daily'
            ? 'bg-brand-500 text-white'
            : 'bg-app-canvas text-app-fg-muted hover:bg-app-hover hover:text-app-fg',
        ].join(' ')}
      >
        Daily
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'detailed'}
        onClick={() => onChange('detailed')}
        className={[
          buttonBase,
          'border-l border-app-border',
          fullWidth ? 'flex-1 text-center' : '',
          value === 'detailed'
            ? 'bg-brand-500 text-white'
            : 'bg-app-canvas text-app-fg-muted hover:bg-app-hover hover:text-app-fg',
        ].join(' ')}
      >
        Detailed
      </button>
    </div>
  );
}

function hasPositiveSpendAmountInput(raw: string): boolean {
  const t = raw.replace(/,/g, '').trim();
  if (t === '') return false;
  const n = Number(t);
  return !Number.isNaN(n) && n > 0;
}

const DEFAULT_AD_SPEND_STATUS_COUNTS: AdSpendStatusCounts = {
  ALL: 0,
  PENDING: 0,
  APPROVED: 0,
  REJECTED: 0,
};

export function MarketingAdSpendPage({
  adSpend,
  totalAdSpend: _totalRowCount,
  page,
  totalPages,
  statusFilter,
  searchFilter,
  productIdFilter,
  campaignIdFilter,
  mediaBuyerIdFilter,
  mediaBuyersForFilter: mediaBuyersForFilterProp,
  statusCounts: statusCountsProp,
  metrics: initialMetrics,
  users: initialUsers,
  products: initialProducts,
  campaigns: campaignsProp,
  filters,
  viewMode = 'admin',
  canApproveAdSpend = false,
  groups: initialGroups,
  groupsPage,
  groupsTotalPages,
  currentUserId,
  picklistsLoading = false,
}: MarketingAdSpendLoaderData & { picklistsLoading?: boolean }) {
  const statusCounts = statusCountsProp ?? DEFAULT_AD_SPEND_STATUS_COUNTS;
  const campaigns = campaignsProp ?? [];
  const mediaBuyersForFilter = mediaBuyersForFilterProp ?? [];
  const dateFilters = filters;
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();
  const secondaryFetcher = useFetcher<SecondaryResponse>();
  const { toast } = useToast();
  const { ensureBranchForAction, requiresBranchSelection } = useBranchScopeActionGuard();
  const isFilterLoading = useLoaderRefetchBusy().busy;
  const [selectedStatus, setSelectedStatus] = useState(statusFilter || 'ALL');
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');
  const [selectedProductId, setSelectedProductId] = useState(productIdFilter || 'ALL');
  const [selectedCampaignId, setSelectedCampaignId] = useState(campaignIdFilter || 'ALL');
  const [selectedMediaBuyerId, setSelectedMediaBuyerId] = useState(mediaBuyerIdFilter || 'ALL');
  const [showAdSpendForm, setShowAdSpendForm] = useState(false);
  // Daily-grouped accordion is the default view. Switching to "detailed"
  // hides the accordion and renders the per-line table inside the same card,
  // so the filters above (status / product / campaign / buyer / search) keep
  // applying without duplication. CEO directive 2026-05-10.
  // Named `expenseListView` to avoid shadowing the page-level `viewMode` prop
  // (`'admin' | 'media_buyer'`) used for scoping the leaderboard.
  // URL-synced: `?view=daily|detailed` so reload / share preserves the active
  // view + the correct pagination param (`gpage` for daily, `page` for detailed).
  const expenseListView: 'daily' | 'detailed' =
    searchParams.get('view') === 'detailed' ? 'detailed' : 'daily';
  const setExpenseListView = (next: 'daily' | 'detailed') => {
    const params = new URLSearchParams(searchParams);
    if (next === 'daily') params.delete('view');
    else params.set('view', next);
    // Inactive view's pagination param is meaningless and just clutters the URL.
    if (next === 'daily') params.delete('page');
    else params.delete('gpage');
    // DateFilterBar globally seeds `eligiblePage=1` on every date change for the
    // delivery-remittances page; this page never reads it — strip it as noise.
    params.delete('eligiblePage');
    setSearchParams(params);
  };
  const [adSpendDetailModal, setAdSpendDetailModal] = useState<AdSpendDetailRecord | null>(null);
  const [rejectStep, setRejectStep] = useState(false);
  const [editTarget, setEditTarget] = useState<AdSpendRecord | null>(null);
  const [editFormCampaignId, setEditFormCampaignId] = useState('');
  const [editFormProductId, setEditFormProductId] = useState('');
  const [editFormSpendDate, setEditFormSpendDate] = useState('');
  const [editFormSpendAmount, setEditFormSpendAmount] = useState('');
  const [editScreenshotUrl, setEditScreenshotUrl] = useState('');
  const [editFileUploadState, setEditFileUploadState] = useState<FileUploadUploadState>('idle');
  const [dismissedError, setDismissedError] = useState(false);

  const userIdsOnPage = useMemo(() => {
    const s = new Set<string>();
    for (const row of adSpend ?? []) {
      if (row.mediaBuyerId) s.add(row.mediaBuyerId);
      if (row.approvedBy) s.add(row.approvedBy);
      if (row.rejectedBy) s.add(row.rejectedBy);
    }
    return Array.from(s);
  }, [adSpend]);

  const secondaryQueryString = useMemo(() => {
    const p = new URLSearchParams();
    if (filters?.startDate) p.set('startDate', filters.startDate);
    if (filters?.endDate) p.set('endDate', filters.endDate);
    if (filters?.periodAllTime) p.set('periodAllTime', 'true');
    if (statusFilter) p.set('status', statusFilter);
    if (searchFilter) p.set('search', searchFilter);
    if (productIdFilter) p.set('productId', productIdFilter);
    if (campaignIdFilter) p.set('campaignId', campaignIdFilter);
    if (mediaBuyerIdFilter) p.set('mediaBuyerId', mediaBuyerIdFilter);
    p.set('gpage', String(groupsPage ?? 1));
    p.set('view', viewMode);
    if (userIdsOnPage.length > 0) p.set('userIds', JSON.stringify(userIdsOnPage));
    return p.toString();
  }, [
    filters?.startDate,
    filters?.endDate,
    filters?.periodAllTime,
    statusFilter,
    searchFilter,
    productIdFilter,
    campaignIdFilter,
    mediaBuyerIdFilter,
    groupsPage,
    viewMode,
    userIdsOnPage,
  ]);

  useEffect(() => {
    void secondaryFetcher.load(`/api/marketing-ad-spend-secondary?${secondaryQueryString}`);
  }, [secondaryQueryString]);

  const secondary = secondaryFetcher.data?.ok ? secondaryFetcher.data : null;
  const secondaryLoading = secondaryFetcher.state === 'loading' && !secondaryFetcher.data;
  const secondaryError = secondaryFetcher.data && !secondaryFetcher.data.ok ? secondaryFetcher.data.error : null;

  const metrics = secondary?.metrics ?? initialMetrics ?? null;
  const users = secondary?.users ?? initialUsers ?? [];
  const products = secondary?.products ?? initialProducts ?? [];
  const groups = secondary?.groups ?? initialGroups ?? [];
  const groupsTotalResolved = secondary?.groupsTotal ?? 0;
  const groupsPageResolved = secondary?.groupsPage ?? groupsPage;
  const groupsTotalPagesResolved = secondary?.groupsTotalPages ?? groupsTotalPages;

  useEffect(() => {
    if (!secondary?.ok) return;
    if (!groupsPageResolved || groupsPageResolved === groupsPage) return;
    setSearchParams(getListParams({ gpage: groupsPageResolved }));
  }, [secondary?.ok, groupsPageResolved]);

  const inlineLoading = secondaryLoading && !secondary && (products.length === 0 || groups.length === 0);

  const [formCampaignId, setFormCampaignId] = useState('');
  const [formProductId, setFormProductId] = useState('');
  const [formSpendDate, setFormSpendDate] = useState('');
  const [formSpendAmount, setFormSpendAmount] = useState('');
  const [formPlatform, setFormPlatform] = useState<AdPlatform>('FACEBOOK');
  const [formPlatformCustomLabel, setFormPlatformCustomLabel] = useState('');
  const [adSpendPreview, setAdSpendPreview] = useState<AdSpendIntervalPreview | null>(null);
  const [adSpendPreviewLoading, setAdSpendPreviewLoading] = useState(false);
  const adSpendPreviewGen = useRef(0);
  const [adSpendScreenshotUrl, setAdSpendScreenshotUrl] = useState('');
  const [adSpendFileUploadState, setAdSpendFileUploadState] = useState<FileUploadUploadState>('idle');

  useEffect(() => {
    setSelectedStatus(statusFilter || 'ALL');
    setSearchQuery(searchFilter || '');
    setSelectedProductId(productIdFilter || 'ALL');
    setSelectedCampaignId(campaignIdFilter || 'ALL');
    setSelectedMediaBuyerId(mediaBuyerIdFilter || 'ALL');
  }, [statusFilter, searchFilter, productIdFilter, campaignIdFilter, mediaBuyerIdFilter]);

  useEffect(() => {
    if (!showAdSpendForm) {
      setFormCampaignId('');
      setFormProductId('');
      setFormSpendDate('');
      setFormSpendAmount('');
      setFormPlatform('FACEBOOK');
      setFormPlatformCustomLabel('');
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

  const getListParams = (overrides: {
    page?: number;
    gpage?: number;
    status?: string;
    search?: string;
    productId?: string;
    campaignId?: string;
    mediaBuyerId?: string;
  }) => {
    const params = new URLSearchParams(searchParams);
    // `eligiblePage` is leaked by the shared DateFilterBar (see delivery-remittances
    // page) — drop it on every URL write so it never crusts onto this page's URL.
    params.delete('eligiblePage');
    if (overrides.page !== undefined) params.set('page', String(overrides.page));
    if (overrides.gpage !== undefined) params.set('gpage', String(overrides.gpage));
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
    if (overrides.campaignId !== undefined) {
      if (overrides.campaignId === 'ALL' || !overrides.campaignId) params.delete('campaignId');
      else params.set('campaignId', overrides.campaignId);
    }
    if (overrides.mediaBuyerId !== undefined) {
      if (overrides.mediaBuyerId === 'ALL' || !overrides.mediaBuyerId) params.delete('mediaBuyerId');
      else params.set('mediaBuyerId', overrides.mediaBuyerId);
    }
    const narrowsGroups =
      overrides.status !== undefined ||
      overrides.search !== undefined ||
      overrides.productId !== undefined ||
      overrides.campaignId !== undefined ||
      overrides.mediaBuyerId !== undefined;
    if (narrowsGroups) params.set('gpage', '1');
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

  const handleAdSpendCampaignChange = (campaignId: string) => {
    setSelectedCampaignId(campaignId);
    setSearchParams(getListParams({ campaignId, page: 1 }));
  };

  const handleAdSpendMediaBuyerChange = (mediaBuyerId: string) => {
    setSelectedMediaBuyerId(mediaBuyerId);
    setSearchParams(getListParams({ mediaBuyerId, page: 1 }));
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
      platform: formPlatform,
      platformCustomLabel:
        formPlatform === 'OTHER' ? formPlatformCustomLabel.trim() : undefined,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message ?? 'Check the form and try again.';
      toast.error('Cannot log ad spend', first);
      return;
    }
    const fd = new FormData(e.currentTarget);
    fd.set('screenshotUrl', parsed.data.screenshotUrl ?? '');
    fd.set('spendAmount', spendRaw);
    fd.set('platform', parsed.data.platform);
    if (parsed.data.platformCustomLabel) {
      fd.set('platformCustomLabel', parsed.data.platformCustomLabel);
    }
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
    fd.set('screenshotUrl', parsed.data.screenshotUrl ?? '');
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
    !adSpendScreenshotUrl.trim() ||
    (formPlatform === 'OTHER' && !formPlatformCustomLabel.trim());

  const editAdSpendSubmitDisabled =
    editFileUploadState === 'uploading' ||
    !editFormCampaignId ||
    !editFormProductId ||
    !editFormSpendDate.trim() ||
    !hasPositiveSpendAmountInput(editFormSpendAmount) ||
    !editScreenshotUrl.trim();

  const actionError = (fetcher.data as { error?: string } | undefined)?.error;
  const adSpendSurface = useFetcherActionSurface(fetcher);
  const adSpendDetailFetcherModalOpen = Boolean(adSpendDetailModal?.screenshotUrl);
  useFetcherToast(fetcher.data, {
    successMessage: 'Action completed',
    skipErrorToast: adSpendDetailFetcherModalOpen,
  });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);
  useEffect(() => {
    if (!actionError) return;
    if (!requiresBranchSelection) return;
    if (!actionError.toLowerCase().includes('branch context required')) return;
    ensureBranchForAction({ actionLabel: 'this ad spend action' });
  }, [actionError, requiresBranchSelection, ensureBranchForAction]);

  // Edge-triggered close-on-success — see CLAUDE.md → "Modal + Optimistic UI Pattern".
  // Replaces three separate `useEffect([actionSuccess, ...])` close paths and
  // the manual revalidate trigger; the hook handles both.
  const handleAdSpendFetcherSuccess = useCallback(() => {
    setShowAdSpendForm(false);
    setAdSpendDetailModal(null);
    setRejectStep(false);
    setEditTarget(null);
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleAdSpendFetcherSuccess);

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

  const getProductName = (productId: string, resolvedProducts: Product[]): string =>
    resolvedProducts.find((p) => p.id === productId)?.name ?? 'Unknown product';
  const getCampaignName = (campaignId: string): string =>
    campaigns.find((c: Campaign) => c.id === campaignId)?.name ?? 'Unknown campaign';
  const getUserName = (userId: string, resolvedUsers: User[]): string =>
    resolvedUsers.find((u) => u.id === userId)?.name ?? 'Unknown user';

  const legacyAdSpendColumns = useMemo((): CompactTableColumn<AdSpendRecord>[] => {
    const cols: CompactTableColumn<AdSpendRecord>[] = [
      {
        key: 'date',
        header: 'Date',
        nowrap: true,
        render: (s) =>
          new Date(s.spendDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' }),
      },
    ];
    if (viewMode !== 'media_buyer') {
      cols.push({
        key: 'mediaBuyer',
        header: 'Media Buyer',
        render: (s) => (
          <span className="text-sm text-app-fg">
            {users.length === 0 && secondaryLoading ? (
              <InlineLoadingText />
            ) : (
              getUserName(s.mediaBuyerId, users)
            )}
          </span>
        ),
      });
    }
    cols.push(
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        nowrap: true,
        render: (s) => <NairaPrice amount={Number(s.spendAmount)} />,
      },
      {
        key: 'product',
        header: 'Product',
        render: (s) => (
          <span className="text-sm text-app-fg-muted">
            {s.productId ? (
              products.length === 0 && secondaryLoading ? (
                <InlineLoadingText />
              ) : (
                <Link
                  to={`/admin/products/${s.productId}`}
                  className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
                >
                  {getProductName(s.productId, products)}
                </Link>
              )
            ) : (
              '\u2014'
            )}
          </span>
        ),
      },
      {
        key: 'campaign',
        header: 'Campaign',
        render: (s) => (
          <span className="text-sm text-app-fg-muted">
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
          </span>
        ),
      },
      {
        key: 'orders',
        header: 'Orders',
        align: 'right',
        render: (s) => (
          <span className="text-sm text-app-fg-muted">{(s.orderCount ?? 0).toLocaleString()}</span>
        ),
      },
      {
        key: 'cpa',
        header: 'CPA',
        align: 'right',
        render: (s) =>
          s.indicativeCpa != null ? (
            <NairaPrice amount={s.indicativeCpa} />
          ) : (
            <span className="text-sm text-app-fg-muted">{'\u2014'}</span>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (s) => <StatusBadge status={s.status ?? 'PENDING'} />,
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        tight: true,
        nowrap: true,
        minWidth: 'min-w-[14rem]',
        mobileShowLabel: false,
        render: (s) => (
          <div className="inline-flex flex-nowrap items-center justify-end gap-2 shrink-0">
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
            {canApproveAdSpend && (s.status ?? 'PENDING') === 'PENDING' && (
              <>
                <fetcher.Form method="post" className="inline">
                  <input type="hidden" name="intent" value="approveAdSpend" />
                  <input type="hidden" name="adSpendId" value={s.id} />
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={
                      fetcher.state === 'submitting' &&
                      fetcher.formData?.get('intent') === 'approveAdSpend' &&
                      fetcher.formData?.get('adSpendId') === s.id
                    }
                  >
                    Approve
                  </Button>
                </fetcher.Form>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setAdSpendDetailModal(s);
                    setRejectStep(true);
                  }}
                >
                  Reject
                </Button>
              </>
            )}
            {adSpendRowCanEdit(s) && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditTarget(s)}>
                Edit
              </Button>
            )}
          </div>
        ),
      },
    );
    return cols;
  }, [viewMode, users, products, campaigns, canApproveAdSpend, fetcher.state, fetcher.formData]);

  const adSpendToolbarFilterBadge = useMemo(() => {
    let n = 0;
    if (selectedProductId !== 'ALL') n += 1;
    if (selectedCampaignId !== 'ALL') n += 1;
    if (viewMode !== 'media_buyer' && mediaBuyersForFilter.length > 0 && selectedMediaBuyerId !== 'ALL') n += 1;
    return n;
  }, [selectedProductId, selectedCampaignId, selectedMediaBuyerId, viewMode, mediaBuyersForFilter.length]);

  const openGroupLineReceiptModal = (line: AdSpendGroupLine) => {
    setAdSpendDetailModal({
      id: line.id,
      mediaBuyerId: line.mediaBuyerId,
      mediaBuyerName: line.mediaBuyerName,
      productId: line.productId,
      campaignId: line.campaignId,
      spendAmount: line.spendAmount,
      screenshotUrl: line.screenshotUrl,
      spendDate: line.spendDate,
      status: line.status,
      approvedAt: line.approvedAt,
      approvedBy: null,
      rejectionReason: line.rejectionReason,
      rejectedAt: line.rejectedAt,
      rejectedBy: null,
      orderCount: line.orderCount ?? 0,
      indicativeCpa: line.indicativeCpa ?? null,
    });
    setRejectStep(false);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ads Expense"
        mobileInlineActions
        description="Log daily ad spend."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Ads Expense tools"
            sheetSubtitle={<span>Date range and new expense entry</span>}
            triggerAriaLabel="Date, add expense, and more"
            filtersBadgeCount={adSpendToolbarFilterBadge}
            filters={
              <>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">View</span>
                  <ExpenseViewToggle value={expenseListView} onChange={setExpenseListView} fullWidth />
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">Product</span>
                  <SearchableSelect
                    id="marketing-adspend-product-filter-sheet"
                    value={selectedProductId}
                    onChange={handleAdSpendProductChange}
                    options={[
                      { value: 'ALL', label: 'All products' },
                      ...products.map((p: Product) => ({ value: p.id, label: p.name })),
                    ]}
                    wrapperClassName="w-full"
                    searchPlaceholder="Search products..."
                  />
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">Campaign</span>
                  {picklistsLoading ? (
                    <div className="h-10 w-full rounded-md border border-app-border bg-app-hover/90 animate-pulse" aria-hidden />
                  ) : (
                    <SearchableSelect
                      id="marketing-adspend-campaign-filter-sheet"
                      value={selectedCampaignId}
                      onChange={handleAdSpendCampaignChange}
                      options={[
                        { value: 'ALL', label: 'All campaigns' },
                        ...campaigns
                          .filter((c: Campaign) => c.status === 'ACTIVE')
                          .map((c: Campaign) => ({ value: c.id, label: c.name })),
                      ]}
                      wrapperClassName="w-full"
                      searchPlaceholder="Search campaigns..."
                    />
                  )}
                </div>
                {viewMode !== 'media_buyer' && (picklistsLoading || mediaBuyersForFilter.length > 0) ? (
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-app-fg-muted">Media buyer</span>
                    {picklistsLoading ? (
                      <div className="h-10 w-full rounded-md border border-app-border bg-app-hover/90 animate-pulse" aria-hidden />
                    ) : (
                      <SearchableSelect
                        id="marketing-adspend-media-buyer-filter-sheet"
                        value={selectedMediaBuyerId}
                        onChange={handleAdSpendMediaBuyerChange}
                        options={[
                          { value: 'ALL', label: 'All media buyers' },
                          ...mediaBuyersForFilter.map((b) => ({ value: b.id, label: b.name })),
                        ]}
                        wrapperClassName="w-full"
                        searchPlaceholder="Search media buyers..."
                      />
                    )}
                  </div>
                ) : null}
              </>
            }
            desktop={
              <>
                <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                  <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime}
                  />
                </div>
                <BranchScopedLink
                  to="/admin/marketing/ad-spend/new"
                  actionLabel="adding ad spend"
                  className="btn-primary btn-sm inline-flex items-center justify-center shrink-0"
                >
                  + Add Expense
                </BranchScopedLink>
                <PageRefreshButton />
              </>
            }
            sheet={({ closeSheet }) => (
              <>
                <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                  <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime}
                    triggerLayout="blockCenter"
                  />
                </div>
                <BranchScopedLink
                  to="/admin/marketing/ad-spend/new"
                  actionLabel="adding ad spend"
                  onClick={() => closeSheet()}
                  className="btn-primary btn-sm w-full justify-center inline-flex items-center"
                >
                  + Add Expense
                </BranchScopedLink>
              </>
            )}
          />
        }
      />

      {actionError && !dismissedError && !adSpendDetailFetcherModalOpen && (
        <PageNotification
          variant="error"
          message={adSpendSurface.friendlyError || actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {metrics ? (
        <OverviewStatStrip
          items={[
            {
              label: 'Total spend',
              value: <>{'\u20A6'}{Math.round(metrics.totalSpend).toLocaleString()}</>,
              valueClassName: 'text-app-fg',
              title: `${metrics.totalOrders} orders, ${metrics.deliveredOrders} delivered`,
            },
            {
              label: 'Orders',
              value: metrics.totalOrders.toLocaleString(),
              valueClassName: 'text-app-fg',
              title: `${metrics.deliveredOrders} delivered for this date range`,
            },
            {
              label: 'Delivered',
              value: metrics.deliveredOrders.toLocaleString(),
              valueClassName: 'text-success-600 dark:text-success-400',
              title: 'Orders delivered to customers in this date range',
            },
            {
              label: 'CPA',
              value: <>{'\u20A6'}{Math.round(metrics.cpa).toLocaleString()}</>,
              valueClassName: 'text-app-fg',
              title: 'Spend / all orders',
            },
            {
              label: 'True ROAS',
              value: <>{metrics.trueRoas.toFixed(2)}x</>,
              valueClassName: 'text-brand-600 dark:text-brand-400',
              title: 'Delivered revenue / spend',
            },
          ]}
        />
      ) : (
        <OverviewStatStripSkeleton count={5} />
      )}

      {/* High-CPA warning banner removed (CEO directive 2026-05-08) — the
          inline alert added an extra render path on every page load without
          changing what an MB or HoM does next. The Profitability column on
          the leaderboard already surfaces the same signal in context. */}

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
                value={formCampaignId}
                onChange={setFormCampaignId}
                searchPlaceholder="Search campaigns..."
                options={campaigns
                  .filter((c: Campaign) => c.status === 'ACTIVE')
                  .map((c: Campaign) => ({ value: c.id, label: c.name }))}
              />
            </div>
            <div>
              <SearchableSelect
                id="marketing-adspend-create-product"
                label="Product"
                placeholder={products.length === 0 && secondaryLoading ? 'Loading products…' : 'Select product...'}
                value={formProductId}
                onChange={setFormProductId}
                disabled={products.length === 0 && secondaryLoading}
                searchPlaceholder="Search products..."
                options={products.map((p: Product) => ({ value: p.id, label: p.name }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1">Spend Amount ({'\u20A6'})</label>
              <AmountInput
                name="spendAmount"
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
                value={formSpendDate}
                onChange={(e) => setFormSpendDate(e.target.value)}
              />
            </div>
            <div>
              <FormSelect
                label="Platform"
                id="marketing-adspend-create-platform"
                value={formPlatform}
                onChange={(e) => {
                  const v = e.target.value as AdPlatform;
                  setFormPlatform(v);
                  if (v !== 'OTHER') setFormPlatformCustomLabel('');
                }}
                options={AD_EXPENSE_PLATFORM_OPTIONS}
              />
            </div>
            {formPlatform === 'OTHER' && (
              <div className="sm:col-span-2">
                <TextInput
                  label="Platform name"
                  id="marketing-adspend-create-platform-custom"
                  value={formPlatformCustomLabel}
                  onChange={(e) => setFormPlatformCustomLabel(e.target.value)}
                  placeholder="e.g. Snapchat, Taboola"
                  maxLength={80}
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <FileUpload
                folder={ASSET_FOLDERS.SCREENSHOTS}
                name="screenshotUrl"
                label="Ads Manager Screenshot"
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
                  value={editFormCampaignId}
                  onChange={setEditFormCampaignId}
                  searchPlaceholder="Search campaigns..."
                  options={campaigns
                    .filter((c: Campaign) => c.status === 'ACTIVE')
                    .map((c: Campaign) => ({ value: c.id, label: c.name }))}
                />
              </div>
              <div>
                <SearchableSelect
                  id="marketing-adspend-edit-product"
                  label="Product"
                  placeholder={products.length === 0 && secondaryLoading ? 'Loading products…' : 'Select product...'}
                  value={editFormProductId}
                  onChange={setEditFormProductId}
                  disabled={products.length === 0 && secondaryLoading}
                  searchPlaceholder="Search products..."
                  options={products.map((p: Product) => ({ value: p.id, label: p.name }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-app-fg-muted mb-1">Spend Amount ({'\u20A6'})</label>
                <AmountInput
                  name="spendAmount"
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
                  value={editFormSpendDate}
                  onChange={(e) => setEditFormSpendDate(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <FileUpload
                  folder={ASSET_FOLDERS.SCREENSHOTS}
                  label="Ads Manager Screenshot"
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

      {/* Phase 17: Daily groups accordion (default) + per-line table —
          chosen via the segmented view-mode control. Same filters apply. */}
      <div className="list-panel">
        <div className="border-b border-app-border px-4 py-3">
          <Tabs
            value={selectedStatus}
            onChange={handleAdSpendStatusChange}
            tabs={AD_SPEND_STATUS_OPTIONS.map((opt) => ({
              value: opt.value,
              label: picklistsLoading
                ? opt.label
                : `${opt.label}${
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
          />
        </div>
        <ToolbarFiltersCollapsible
          hideMobileSheet
          badgeCount={adSpendToolbarFilterBadge}
          sheetSubtitle={<span>Product, campaign, and buyer filters apply immediately</span>}
          searchRow={
            <form onSubmit={handleAdSpendSearchSubmit} className="flex min-w-0 gap-2 md:min-w-0 md:flex-1">
              <SearchInput
                value={searchQuery}
                onChange={(val) => setSearchQuery(val)}
                placeholder="Search ads…"
                withSubmitButton
                wrapperClassName="min-w-0 flex-1"
              />
            </form>
          }
          desktopInlineFilters={
            <>
              <SearchableSelect
                id="marketing-adspend-product-filter-main"
                value={selectedProductId}
                onChange={handleAdSpendProductChange}
                options={[
                  { value: 'ALL', label: 'All products' },
                  ...products.map((p: Product) => ({ value: p.id, label: p.name })),
                ]}
                wrapperClassName="w-auto min-w-[12rem]"
                searchPlaceholder="Search products..."
              />
              {picklistsLoading ? (
                <div
                  className="h-9 w-full min-w-0 rounded-md border border-app-border bg-app-hover/90 animate-pulse sm:min-w-[12rem]"
                  aria-hidden
                />
              ) : (
                <SearchableSelect
                  id="marketing-adspend-campaign-filter"
                  value={selectedCampaignId}
                  onChange={handleAdSpendCampaignChange}
                  options={[
                    { value: 'ALL', label: 'All campaigns' },
                    ...campaigns
                      .filter((c: Campaign) => c.status === 'ACTIVE')
                      .map((c: Campaign) => ({ value: c.id, label: c.name })),
                  ]}
                  wrapperClassName="w-auto min-w-[12rem]"
                  searchPlaceholder="Search campaigns..."
                />
              )}
              {viewMode !== 'media_buyer' && (picklistsLoading || mediaBuyersForFilter.length > 0) ? (
                picklistsLoading ? (
                  <div
                    className="h-9 w-full min-w-0 rounded-md border border-app-border bg-app-hover/90 animate-pulse sm:min-w-[12rem]"
                    aria-hidden
                  />
                ) : (
                  <SearchableSelect
                    id="marketing-adspend-media-buyer-filter"
                    value={selectedMediaBuyerId}
                    onChange={handleAdSpendMediaBuyerChange}
                    options={[
                      { value: 'ALL', label: 'All media buyers' },
                      ...mediaBuyersForFilter.map((b) => ({ value: b.id, label: b.name })),
                    ]}
                    wrapperClassName="w-auto min-w-[12rem]"
                    searchPlaceholder="Search media buyers..."
                  />
                )
              ) : null}
              <ExpenseViewToggle value={expenseListView} onChange={setExpenseListView} />
            </>
          }
          sheetFilterBody={null}
        />
        <TableLoadingOverlay show={isFilterLoading}>
          {expenseListView === 'daily' ? (
            <div className="p-4">
              <AdSpendDayAccordion
                groups={groups}
                showMediaBuyerColumn={viewMode !== 'media_buyer'}
                canModerate={canApproveAdSpend}
                currentUserId={currentUserId}
                page={groupsPage}
                totalPages={groupsTotalPages}
                actionUrl="/admin/marketing/ad-spend"
                onPreviewReceipt={openGroupLineReceiptModal}
                onEdit={(line) =>
                  setEditTarget({
                    id: line.id,
                    mediaBuyerId: line.mediaBuyerId,
                    productId: line.productId,
                    campaignId: line.campaignId,
                    spendAmount: line.spendAmount,
                    screenshotUrl: line.screenshotUrl,
                    adUrl: line.adUrl,
                    platform: line.platform,
                    platformCustomLabel: line.platformCustomLabel ?? null,
                    spendDate: line.spendDate,
                    status: line.status,
                    approvedAt: line.approvedAt,
                    approvedBy: null,
                    rejectionReason: line.rejectionReason,
                    rejectedAt: line.rejectedAt,
                    rejectedBy: null,
                    orderCount: line.orderCount ?? 0,
                    indicativeCpa: line.indicativeCpa ?? null,
                  })
                }
              />
            </div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <CompactTable
                  withCard={false}
                  className="min-w-[920px]"
                  columns={legacyAdSpendColumns}
                  rows={adSpend}
                  rowKey={(s) => s.id}
                  emptyTitle="No ad spend records yet"
                />
              </div>

              <div className="md:hidden space-y-3 px-1 py-3">
          {adSpend.map((s: AdSpendRecord) => (
            <div key={s.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-app-fg"><NairaPrice amount={Number(s.spendAmount)} /></span>
                <StatusBadge status={s.status ?? 'PENDING'} />
              </div>
              <p className="text-sm text-app-fg-muted">
                {users.length === 0 && secondaryLoading ? (
                  <InlineLoadingText />
                ) : (
                  <>
                    {getUserName(s.mediaBuyerId, users)}
                    {' \u2014 '}
                    {new Date(s.spendDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </>
                )}
              </p>
              <p className="text-xs text-app-fg-muted">
                {products.length === 0 && secondaryLoading ? (
                  <InlineLoadingText />
                ) : (
                  <>
                    Product:{' '}
                    {s.productId ? (
                      <Link
                        to={`/admin/products/${s.productId}`}
                        className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
                      >
                        {getProductName(s.productId, products)}
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
              <div className="inline-flex flex-nowrap items-center gap-2 mt-2 overflow-x-auto max-w-full">
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
                {canApproveAdSpend && (s.status ?? 'PENDING') === 'PENDING' && (
                  <>
                    <fetcher.Form method="post" className="inline">
                      <input type="hidden" name="intent" value="approveAdSpend" />
                      <input type="hidden" name="adSpendId" value={s.id} />
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        loading={
                          fetcher.state === 'submitting' &&
                          fetcher.formData?.get('intent') === 'approveAdSpend' &&
                          fetcher.formData?.get('adSpendId') === s.id
                        }
                      >
                        Approve
                      </Button>
                    </fetcher.Form>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setAdSpendDetailModal(s);
                        setRejectStep(true);
                      }}
                    >
                      Reject
                    </Button>
                  </>
                )}
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
            </>
          )}
        </TableLoadingOverlay>
      </div>

      {adSpendDetailModal?.screenshotUrl && (
        <Modal
          open
          onClose={() => setAdSpendDetailModal(null)}
          maxWidth="max-w-lg"
          role="dialog"
          contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]"
        >
          <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <h3 className="text-lg font-semibold text-app-fg">Ads Expense</h3>
            <button type="button" onClick={() => setAdSpendDetailModal(null)} className="text-app-fg-muted hover:text-app-fg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5">
            <ModalFetcherInlineError
              message={adSpendSurface.errorMatchingIntent(['approveAdSpend', 'rejectAdSpend'])}
            />
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
              {adSpendDetailModal.platform && (
                <p className="text-sm text-brand-600 dark:text-brand-400">
                  Platform:{' '}
                  {adSpendDetailModal.platform === 'OTHER'
                    ? adSpendDetailModal.platformCustomLabel?.trim() || 'Other'
                    : AD_EXPENSE_PLATFORM_OPTIONS.find((o) => o.value === adSpendDetailModal.platform)?.label ??
                      adSpendDetailModal.platform}
                </p>
              )}
              <p className="text-xs text-brand-500 dark:text-brand-400">
                Media buyer:{' '}
                {users.length === 0 && secondaryLoading ? (
                  <InlineLoadingText />
                ) : (
                  <>
                    {adSpendDetailModal.mediaBuyerName ?? getUserName(adSpendDetailModal.mediaBuyerId, users)}
                    {adSpendDetailModal.status === 'APPROVED' && adSpendDetailModal.approvedBy && (
                      <>
                        {' · '}
                        Approved by: {getUserName(adSpendDetailModal.approvedBy, users)}
                      </>
                    )}
                  </>
                )}
              </p>
              <p className="text-xs text-brand-500 dark:text-brand-400">
                Product:{' '}
                {products.length === 0 && secondaryLoading ? (
                  <InlineLoadingText />
                ) : adSpendDetailModal.productId ? (
                  getProductName(adSpendDetailModal.productId, products)
                ) : (
                  '\u2014'
                )}
                {' · '}
                Campaign: {adSpendDetailModal.campaignId ? getCampaignName(adSpendDetailModal.campaignId) : '\u2014'}
              </p>
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
                      {users.length === 0 && secondaryLoading ? (
                        <InlineLoadingText />
                      ) : (
                        getUserName(adSpendDetailModal.rejectedBy, users)
                      )}
                    </>
                  ) : null}
                </p>
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
            {canApproveAdSpend && adSpendDetailModal.status === 'PENDING' && !rejectStep && (
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
            {canApproveAdSpend && adSpendDetailModal.status === 'PENDING' && rejectStep && (
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
