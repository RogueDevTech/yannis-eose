import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { isOptimisticId } from '~/lib/optimistic';
import { ExportModal } from '~/components/ui/export-modal';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { InlineNotification } from '~/components/ui/inline-notification';
import { RouteFetchErrorBanner } from '~/components/ui/route-fetch-error-banner';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import { SortMenu } from '~/components/ui/sort-menu';
import { useFetcherToast } from '~/components/ui/toast';
import { TextInput } from '~/components/ui/text-input';
import { NumberInput } from '~/components/ui/number-input';
import { Textarea } from '~/components/ui/textarea';
import { FormSelect } from '~/components/ui/form-select';
import { RadioGroup } from '~/components/ui/radio-group';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { SearchInput } from '~/components/ui/search-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import {
  CompactTable,
  CompactTableActions,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import type {
  InventoryLevel, InventoryStreamData, ProductOption, LocationOption,
  Transfer, ReturnedOrder, Reconciliation, LocationWithLock, LowStockAlertsResult, ShipmentFilterOption,
  LocationLowStockThreshold,
} from './types';
import { REASON_LABELS } from './types';
import { FilterDismiss } from '~/components/ui/filter-dismiss';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { LowStockAlertsDeferredFallback, ReconciliationTableDeferredFallback } from './InventoryDeferredFallbacks';

/** Horizontally scrollable alert card strip with left/right arrow buttons. */
function LowStockAlertStrip({ items }: { items: LowStockAlertItem[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [checkScroll, items.length]);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -300 : 300, behavior: 'smooth' });
  };

  const ArrowBtn = ({ dir }: { dir: 'left' | 'right' }) => (
    <button
      type="button"
      onClick={() => scroll(dir)}
      className={`absolute top-1/2 -translate-y-1/2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-warning-100 dark:bg-warning-900/60 border border-warning-300 dark:border-warning-700 shadow-sm text-warning-700 dark:text-warning-300 hover:bg-warning-200 dark:hover:bg-warning-800 transition-colors ${dir === 'left' ? 'left-0' : 'right-0'}`}
      aria-label={`Scroll ${dir}`}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d={dir === 'left' ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
      </svg>
    </button>
  );

  return (
    <div className="relative mt-3">
      {canScrollLeft && <ArrowBtn dir="left" />}
      {canScrollRight && <ArrowBtn dir="right" />}
      <div ref={scrollRef} className="flex gap-2 overflow-x-auto scrollbar-hide px-1 -mx-1">
        {items.map((item) => {
          const isEmpty = !item.productId;
          const cardContent = (
            <>
              <p className="text-xs font-semibold text-app-fg leading-snug line-clamp-2">{item.productName}</p>
              <p className="text-mini text-app-fg-muted mt-0.5 line-clamp-1">{item.locationName}</p>
              <p
                className={`text-xs font-bold tabular-nums mt-1.5 ${
                  item.availableCount <= 0
                    ? 'text-danger-600 dark:text-danger-400'
                    : 'text-warning-800 dark:text-warning-200'
                }`}
              >
                {isEmpty ? '0 stock' : `${item.availableCount} avail`}
              </p>
            </>
          );
          return (
            <div
              key={item.levelId}
              className="shrink-0 w-36 rounded-md border border-warning-200/90 dark:border-warning-800/80 bg-app-elevated/90 dark:bg-warning-950/25 px-2.5 py-2 shadow-sm"
            >
              {isEmpty ? (
                <div title={`${item.locationName}: no stock received yet`}>
                  {cardContent}
                </div>
              ) : (
                <Link
                  to={`/admin/inventory/${item.levelId}`}
                  prefetch="intent"
                  className="block hover:opacity-90 transition-opacity"
                  title={`${item.productName}: ${item.locationName}`}
                >
                  {cardContent}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type LowStockAlertItem = LowStockAlertsResult['items'][number];

function LowStockAlertsCard({ alerts }: { alerts: LowStockAlertsResult }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/20 px-3 py-3 sm:px-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <svg className="w-5 h-5 text-warning-600 dark:text-warning-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <p className="text-sm font-medium text-warning-800 dark:text-warning-200 min-w-0 flex-1">
          {alerts.items.length} {alerts.items.length === 1 ? 'item' : 'items'} below the{' '}
          <span className="tabular-nums">{alerts.threshold}</span>-unit threshold or with no stock
        </p>
        <svg
          className={`w-4 h-4 text-warning-600 dark:text-warning-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && <LowStockAlertStrip items={alerts.items} />}
    </div>
  );
}

export function InventoryPage(props: InventoryStreamData) {
  if (props.inventoryExtras) {
    const { inventoryExtras, ...rest } = props;
    return (
      <DeferredSection resolve={inventoryExtras} fallback={<LowStockAlertsDeferredFallback />}>
        {(extras) => (
          <InventoryPage
            {...rest}
            lowStockThreshold={extras.lowStockThreshold}
            lowStockAlerts={Promise.resolve(extras.lowStockAlerts)}
            shipmentOptions={extras.shipmentOptions}
            warehouses={extras.warehouses}
          />
        )}
      </DeferredSection>
    );
  }

  const {
    levels,
    levelsTotals,
    totalLevels,
    levelsPage = 1,
    levelsTotalPages = 1,
    levelsLimit = 20,
    levelsProductFilter: serverProductFilter = '', levelsLocationFilter: serverLocationFilter = '',
    levelsProviderFilter: serverProviderFilter = '', levelsShipmentFilter: serverShipmentFilter = '',
    levelsSearch: serverSearch = '',
    levelsSort: serverSort = 'default',
    levelsSortBy: serverSortBy = 'updatedAt',
    levelsSortDir: serverSortDir = 'desc',
    displayLocations = [] as LocationOption[],
    movements: _movements,
    products,
    locations,
    canIntake = false,
    canReadShipments = false,
    canAdjust = false,
    canExport = false,
    transfers, returnedOrders, reconciliations, locationsWithLock,
    lowStockThreshold = 100, canEditLowStock = false, canEditGlobalThreshold = false, lowStockAlerts,
    locationThresholds = [] as LocationLowStockThreshold[],
    shipmentOptions = [] as ShipmentFilterOption[],
    levelsLoadError = null,
    movementsLoadError = null,
  } = props;

  const hasTransfers = !!transfers;
  const hasReturns = !!returnedOrders;

  type TabValue =
    | 'levels'
    | 'transfers'
    | 'returns'
    | 'reconciliation';
  const [activeTab, setActiveTab] = useState<TabValue>('levels');

  // Stock Levels filter + sort are URL-driven so the backend can do the actual filter/sort/paginate.
  // `levelsProductFilter` empty string = no filter (backend default).
  type LevelsSort = 'default' | 'lowestAvailable' | 'highestAvailable';
  const [searchParams, setSearchParams] = useSearchParams();

  const updateLevelsParam = (key: 'productId' | 'locationId' | 'providerId' | 'shipmentId' | 'sort' | 'search', value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!value || value === 'ALL' || value === 'default') next.delete(key);
      else next.set(key, value);
      // Any filter/sort/search change resets to page 1.
      next.delete('page');
      return next;
    }, { preventScrollReset: true });
  };

  const updateLevelsSort = (sortBy: 'available' | 'updatedAt', sortDir: 'asc' | 'desc') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      // Default is updatedAt desc — drop the params entirely so the URL stays clean.
      const isDefault = sortBy === 'updatedAt' && sortDir === 'desc';
      if (isDefault) {
        next.delete('sortBy');
        next.delete('sortDir');
        next.delete('sort');
      } else {
        next.set('sortBy', sortBy);
        next.set('sortDir', sortDir);
        // Drop the legacy fused param so it doesn't compete on the next read.
        next.delete('sort');
      }
      next.delete('page');
      return next;
    }, { preventScrollReset: true });
  };

  const resetLevelsFilters = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('productId');
      next.delete('locationId');
      next.delete('providerId');
      next.delete('shipmentId');
      next.delete('sort');
      next.delete('sortBy');
      next.delete('sortDir');
      next.delete('search');
      next.delete('page');
      return next;
    }, { preventScrollReset: true });
  };

  // Controlled search input — submitted on form submit (Enter) or when the user clears it.
  const [searchInput, setSearchInput] = useState(serverSearch);
  useEffect(() => { setSearchInput(serverSearch); }, [serverSearch]);

  const submitSearch = (next: string) => {
    const trimmed = next.trim();
    if (trimmed === serverSearch) return;
    updateLevelsParam('search', trimmed);
  };

  const isLoadingLevels = useLoaderRefetchBusy().busy;

  const isEmptyLocationRow = (id: string) => id.startsWith('empty:');
  const productName = (id: string) => {
    if (id.startsWith('empty:')) return 'No product';
    return products.find((p) => p.id === id)?.name ?? 'No stock received';
  };
  const locationTagClasses = (providerKind: LocationOption['providerKind']) =>
    providerKind === 'WAREHOUSE'
      ? 'border-brand-600 bg-brand-600 text-white shadow-sm dark:border-brand-500 dark:bg-brand-500 dark:text-slate-950'
      : 'border-app-border bg-app-hover text-app-fg-muted';
  const locationName = (id: string | null) => {
    if (!id) return '—';
    const loc = displayLocations.find((l) => l.id === id) ?? locations.find((l) => l.id === id);
    if (!loc) return 'Unknown location';
    return loc.providerName && loc.providerName !== 'Our warehouses' ? `${loc.name} • ${loc.providerName}` : loc.name;
  };

  const locationLabelParts = (
    id: string | null,
  ): { name: string; tag?: string; providerKind: LocationOption['providerKind'] } => {
    if (!id) return { name: '—', providerKind: null };
    const loc = displayLocations.find((l) => l.id === id) ?? locations.find((l) => l.id === id);
    if (!loc) return { name: 'Unknown location', providerKind: null };
    const tag = loc.providerName ?? (loc.providerKind === 'WAREHOUSE' ? 'Our warehouse' : undefined);
    return { name: loc.name, providerKind: loc.providerKind, ...(tag ? { tag } : {}) };
  };

  // displayedLevels is computed below — after the optimisticLevels hook fires
  // (it depends on `fetcher` which isn't declared yet here).
  const currentProductFilter = serverProductFilter || 'ALL';
  const currentLocationFilter = serverLocationFilter || 'ALL';
  const currentShipmentFilter = serverShipmentFilter || 'ALL';
  const currentSort: LevelsSort = serverSort;

  const goToReceiveShipment = () => {
    window.location.href = '/admin/shipments/receive';
  };

  type AdjustDirection = 'increase' | 'decrease';
  // Adjust modal: row-level stock correction (signed ADJUSTMENT); direction sets UX + sign.
  const [editingLevel, setEditingLevel] = useState<InventoryLevel | null>(null);
  const [adjustDirection, setAdjustDirection] = useState<AdjustDirection | null>(null);
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustQty, setAdjustQty] = useState('');
  const adjustFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const adjustSurface = useFetcherActionSurface(adjustFetcher);

  const openAdjustModal = (level: InventoryLevel) => {
    setEditingLevel(level);
    setAdjustDirection('decrease');
    setAdjustQty('');
    setAdjustReason('');
  };

  const closeAdjustModal = () => {
    setEditingLevel(null);
    setAdjustDirection(null);
    setAdjustQty('');
    setAdjustReason('');
  };

  const signedAdjustmentQuantityStr = useMemo(() => {
    const n = parseInt(adjustQty.trim(), 10);
    if (!Number.isFinite(n) || n < 1) return '';
    if (adjustDirection === 'decrease') return String(-n);
    if (adjustDirection === 'increase') return String(n);
    return '';
  }, [adjustQty, adjustDirection]);

  useEffect(() => {
    if (adjustFetcher.state === 'idle' && adjustFetcher.data?.success) {
      setEditingLevel(null);
      setAdjustDirection(null);
      setAdjustReason('');
      setAdjustQty('');
    }
  }, [adjustFetcher.state, adjustFetcher.data]);

  const fetcher = useFetcher();

  // Products stocked per location — derived from levels for the low-stock modal.
  const productsAtLocation = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const lv of levels) {
      if (!lv.locationId || !lv.productId) continue;
      const name = products.find((p) => p.id === lv.productId)?.name;
      if (!name) continue;
      const arr = map.get(lv.locationId);
      if (arr) { if (!arr.includes(name)) arr.push(name); }
      else map.set(lv.locationId, [name]);
    }
    return map;
  }, [levels, products]);

  // Low-stock alerts — resolved from deferred promise, shown via header button
  const [resolvedAlerts, setResolvedAlerts] = useState<LowStockAlertsResult | null>(null);
  useEffect(() => {
    if (!lowStockAlerts) return;
    Promise.resolve(lowStockAlerts).then((a) => {
      const result = a as LowStockAlertsResult;
      if (result?.items?.length > 0) setResolvedAlerts(result);
    }).catch(() => {});
  }, [lowStockAlerts]);

  // Low-stock threshold editor (admin-only)
  const [showThresholdModal, setShowThresholdModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [draftThreshold, setDraftThreshold] = useState<number>(lowStockThreshold);
  useEffect(() => { setDraftThreshold(lowStockThreshold); }, [lowStockThreshold]);
  // (Org-wide + per-location thresholds are bulk-saved via bulkThresholdFetcher below.)
  // Global-threshold submit reloads the route; the modal stays open so the
  // admin can also tweak per-location overrides in the same session.

  // Per-location threshold drafts — always editable, bulk-saved.
  // Map of locationId → draft value (number = override, '' = inherit org-wide).
  const [locationDrafts, setLocationDrafts] = useState<Map<string, number | ''>>(new Map());
  // Seed drafts when locationThresholds arrive or modal opens.
  useEffect(() => {
    if (showThresholdModal && locationThresholds.length > 0) {
      setLocationDrafts(
        new Map(locationThresholds.map((l) => [l.id, l.lowStockThreshold ?? ''])),
      );
    }
  }, [showThresholdModal, locationThresholds]);
  const updateLocationDraft = (id: string, value: number | '') => {
    setLocationDrafts((prev) => new Map(prev).set(id, value));
  };

  // Bulk save fetcher — org-wide + all changed locations in one submit.
  const bulkThresholdFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const bulkThresholdSurface = useFetcherActionSurface(bulkThresholdFetcher);
  useEffect(() => {
    if (bulkThresholdFetcher.state === 'idle' && bulkThresholdFetcher.data?.success) {
      setShowThresholdModal(false);
    }
  }, [bulkThresholdFetcher.state, bulkThresholdFetcher.data]);

  // Compute which locations changed vs their server value.
  const locationChanges = locationThresholds
    .filter((loc) => {
      const draft = locationDrafts.get(loc.id);
      if (draft === undefined) return false;
      const serverVal = loc.lowStockThreshold; // number | null
      if (draft === '' && serverVal == null) return false; // both inherit — no change
      if (draft === '' && serverVal != null) return true; // clearing override
      if (typeof draft === 'number' && draft !== serverVal) return true;
      return false;
    })
    .map((loc) => {
      const draft = locationDrafts.get(loc.id);
      return { locationId: loc.id, threshold: draft === '' ? null : (draft as number) };
    });

  const globalChanged = canEditGlobalThreshold && draftThreshold !== lowStockThreshold;
  const hasAnyChange = globalChanged || locationChanges.length > 0;

  function handleBulkSave() {
    const fd = new FormData();
    fd.set('intent', 'bulkSaveThresholds');
    fd.set('globalThreshold', canEditGlobalThreshold ? String(draftThreshold) : '');
    fd.set('locationChanges', JSON.stringify(locationChanges));
    bulkThresholdFetcher.submit(fd, { method: 'post' });
  }

  useFetcherToast(adjustFetcher.data, {
    successMessage: 'Stock adjusted',
    skipErrorToast: !!(editingLevel && adjustDirection),
  });
  useFetcherToast(bulkThresholdFetcher.data, {
    successMessage: 'All thresholds saved',
    skipErrorToast: showThresholdModal,
  });

  // ── Peek modal state (mobile card tap → detail sheet) ──
  const [peekLevel, setPeekLevel] = useState<InventoryLevel | null>(null);

  const pageStockSum = levels.reduce((sum, l) => sum + l.stockCount, 0);
  const pageReservedSum = levels.reduce((sum, l) => sum + l.reservedCount, 0);
  const totalStock = levelsTotals?.totalStock ?? pageStockSum;
  const totalReserved = levelsTotals?.totalReserved ?? pageReservedSum;
  const totalLocations = levelsTotals?.totalLocations ?? new Set(levels.map((l) => l.locationId)).size;

  /** CompactTable columns for stock levels — `hideOnMobile` drops Reserved + Status
   *  on narrow desktop table columns; mobile uses card rows from the same component. */
  const levelColumns: CompactTableColumn<InventoryLevel>[] = [
    {
      key: 'product',
      header: 'Product',
      hideable: false,
      render: (level) => {
        const isOptimistic = isOptimisticId(level.id);
        const isEmpty = isEmptyLocationRow(level.id);
        return (
          <span className={`font-medium ${isEmpty ? 'text-app-fg-muted italic' : 'text-app-fg'}`}>
            {productName(level.productId)}
            {isOptimistic && (
              <span className="ml-2 text-micro uppercase tracking-wide text-app-fg-muted italic">Saving…</span>
            )}
          </span>
        );
      },
    },
    {
      key: 'location',
      header: 'Location',
      render: (level) => {
        const parts = locationLabelParts(level.locationId);
        return (
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className="text-app-fg-muted truncate">{parts.name}</span>
            {parts.providerKind === 'WAREHOUSE' ? (
              // "Our warehouse" — circle-only tag (text dropped per CEO ask);
              // `title` keeps the meaning on hover.
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full bg-brand-600 dark:bg-brand-500"
                title="Our warehouse"
                aria-label="Our warehouse"
              />
            ) : parts.tag ? (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-micro font-medium whitespace-nowrap ${locationTagClasses(parts.providerKind)}`}
              >
                {parts.tag}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'shipments',
      header: 'Shipment (FIFO)',
      render: (level) => {
        const layers = level.shipmentLayers ?? [];
        const manual = level.hasManualFifoRemaining === true;
        if (layers.length === 0 && !manual) {
          return <span className="text-app-fg-muted text-xs">—</span>;
        }
        return (
          <div className="flex flex-wrap gap-1 justify-end sm:justify-start max-w-[16rem]">
            {layers.map((s) => (
              canReadShipments ? (
                <Link
                  key={s.id}
                  to={`/admin/shipments/${s.id}`}
                  prefetch="intent"
                  className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline whitespace-nowrap"
                >
                  {s.referenceLabel}
                </Link>
              ) : (
                <span
                  key={s.id}
                  className="text-xs font-medium text-app-fg-muted whitespace-nowrap"
                  title="Shipment detail page requires shipment access"
                >
                  {s.referenceLabel}
                </span>
              )
            ))}
            {manual && (
              <span className="text-xs rounded px-1.5 py-0.5 border border-app-border bg-app-hover text-app-fg-muted whitespace-nowrap">
                Manual intake
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'stock',
      header: 'Stock',
      align: 'right',
      render: (level) => <span className="font-medium tabular-nums">{level.stockCount}</span>,
    },
    {
      key: 'reserved',
      header: 'Reserved',
      align: 'right',
      hideOnMobile: true,
      render: (level) => (
        <span className="text-warning-600 dark:text-warning-400 tabular-nums">{level.reservedCount}</span>
      ),
    },
    {
      key: 'available',
      header: 'Available',
      align: 'right',
      render: (level) => {
        const available = level.stockCount - level.reservedCount;
        const isLow = available < lowStockThreshold;
        return (
          <span className={`font-medium tabular-nums ${isLow ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
            {available}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      hideOnMobile: true,
      render: (level) => {
        if (isEmptyLocationRow(level.id)) {
          return <StatusBadge status="Low stock" />;
        }
        const available = level.stockCount - level.reservedCount;
        const isLow = available < lowStockThreshold;
        if (isLow) {
          return <StatusBadge status="Low stock" />;
        }
        return <StatusBadge status={level.status} />;
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      hideable: false,
      render: (level) => {
        if (isEmptyLocationRow(level.id)) return null;
        const isOptimistic = isOptimisticId(level.id);
        return (
          <div className="inline-flex items-center justify-end gap-1.5">
            {isOptimistic ? (
              <TableActionButton inert variant="primary">View</TableActionButton>
            ) : (
              <TableActionButton to={`/admin/inventory/${level.id}`} prefetch="intent" variant="primary">
                View
              </TableActionButton>
            )}
            {canAdjust && (
              <>
                <TableActionButton
                  variant="neutral"
                  disabled={isOptimistic}
                  onClick={() => openAdjustModal(level)}
                >
                  Reconcile
                </TableActionButton>
              </>
            )}
          </div>
        );
      },
    },
  ];

  // ── Levels-tab filter controls ────────────────────────────────────────
  // Hoisted out of the JSX (was an inline IIFE) so the page-header kebab AND
  // the toolbar can share the same filter elements — one mobile actions group.
  const levelsHasActiveFilters =
    currentProductFilter !== 'ALL' ||
    currentLocationFilter !== 'ALL' ||
    !!serverProviderFilter ||
    currentShipmentFilter !== 'ALL' ||
    serverSortBy !== 'updatedAt' ||
    serverSortDir !== 'desc' ||
    !!serverSearch;
  const levelsFilterBadgeCount =
    (currentProductFilter !== 'ALL' ? 1 : 0) +
    (currentLocationFilter !== 'ALL' ? 1 : 0) +
    (serverProviderFilter ? 1 : 0) +
    (currentShipmentFilter !== 'ALL' ? 1 : 0) +
    (serverSortBy !== 'updatedAt' || serverSortDir !== 'desc' ? 1 : 0);
  /** Toolbar hides entirely when there's no data AND no active filter. */
  const levelsShowToolbar = !(totalLevels === 0 && !levelsHasActiveFilters);
  const levelsProductSelect = (
    <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
      {currentProductFilter !== 'ALL' && (
        <FilterDismiss onClear={() => updateLevelsParam('productId', '')} />
      )}
      <SearchableSelect
        id="levels-product-filter"
        value={currentProductFilter}
        onChange={(v) => updateLevelsParam('productId', v)}
        wrapperClassName="w-full"
        triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
        placeholder="All products"
        searchPlaceholder="Search products..."
        options={[
          { value: 'ALL', label: 'All products' },
          ...products.map((p: ProductOption) => ({ value: p.id, label: p.name })),
        ]}
      />
    </div>
  );
  const levelsLocationSelect = (
    <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
      {currentLocationFilter !== 'ALL' && (
        <FilterDismiss onClear={() => updateLevelsParam('locationId', '')} />
      )}
      <SearchableSelect
        id="levels-location-filter"
        value={currentLocationFilter}
        onChange={(v) => updateLevelsParam('locationId', v)}
        wrapperClassName="w-full"
        triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
        placeholder="All locations"
        searchPlaceholder="Search locations..."
        options={[
          { value: 'ALL', label: 'All locations' },
          ...(displayLocations.length > 0 ? displayLocations : locations).map((l: LocationOption) => ({
            value: l.id,
            label: l.name,
            ...(l.providerKind === 'WAREHOUSE'
              ? {
                  leading: (
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full bg-brand-600 dark:bg-brand-500"
                      title="Our warehouse"
                      aria-label="Our warehouse"
                    />
                  ),
                }
              : l.providerName
                ? {
                    leading: (
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-micro font-medium whitespace-nowrap ${locationTagClasses(l.providerKind)}`}
                      >
                        {l.providerName}
                      </span>
                    ),
                  }
                : {}),
          })),
        ]}
      />
    </div>
  );
  const levelsShipmentSelect = (
    <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
      {currentShipmentFilter !== 'ALL' && (
        <FilterDismiss onClear={() => updateLevelsParam('shipmentId', '')} />
      )}
      <SearchableSelect
        id="levels-shipment-filter"
        value={currentShipmentFilter}
        onChange={(v) => updateLevelsParam('shipmentId', v)}
        wrapperClassName="w-full"
        triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
        placeholder="All shipments"
        searchPlaceholder="Search SHIP ref…"
        options={[
          { value: 'ALL', label: 'All shipments' },
          ...shipmentOptions.map((shipment) => ({
            value: shipment.id,
            label: shipment.label,
          })),
        ]}
      />
    </div>
  );
  const levelsSortMenu = (
    <SortMenu
      value={{ sortBy: serverSortBy, sortDir: serverSortDir }}
      onChange={(next) =>
        updateLevelsSort(next.sortBy as 'available' | 'updatedAt', next.sortDir)
      }
      defaultValue={{ sortBy: 'updatedAt', sortDir: 'desc' }}
      options={[
        {
          value: 'updatedAt',
          label: 'Last updated',
          description: 'Most recently changed inventory rows.',
          ascLabel: 'Oldest first',
          descLabel: 'Newest first',
          defaultDir: 'desc',
        },
        {
          value: 'available',
          label: 'Available units',
          description: 'Stock count minus units reserved on open orders.',
          ascLabel: 'Lowest first',
          descLabel: 'Highest first',
          defaultDir: 'desc',
        },
      ]}
    />
  );
  const levelsResetBtn = levelsHasActiveFilters ? (
    <button
      type="button"
      onClick={resetLevelsFilters}
      className="text-xs text-brand-600 dark:text-brand-400 hover:underline self-center shrink-0"
    >
      Reset
    </button>
  ) : null;
  const levelsFilterControls = (
    <>
      {levelsProductSelect}
      {levelsLocationSelect}
      {levelsShipmentSelect}
      {levelsSortMenu}
      {levelsResetBtn && <div className="pt-1">{levelsResetBtn}</div>}
    </>
  );

  return (
    <div className="space-y-4">
      {/* Page header */}
      <PageHeader
        title="Inventory"
        mobileInlineActions
        description="Track stock and reservations."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Inventory toolbar"
            saveFilterKey
            filtersBadgeCount={
              activeTab === 'levels' && levelsShowToolbar ? levelsFilterBadgeCount : 0
            }
            onClearFilters={levelsHasActiveFilters ? resetLevelsFilters : undefined}
            filters={
              activeTab === 'levels' && levelsShowToolbar ? levelsFilterControls : undefined
            }
            desktop={
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <PageRefreshButton />
                <button
                  type="button"
                  onClick={() => canEditLowStock && setShowThresholdModal(true)}
                  disabled={!canEditLowStock}
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-app-border bg-app-elevated transition-colors whitespace-nowrap ${
                    canEditLowStock
                      ? 'text-app-fg-muted hover:text-app-fg hover:border-app-border-strong cursor-pointer'
                      : 'text-app-fg-muted cursor-default'
                  }`}
                  title={canEditLowStock ? 'Click to change low-stock alert threshold' : 'Low-stock alert threshold (read-only)'}
                >
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                    />
                  </svg>
                  <span>
                    <span className="sm:hidden">&lt; <strong className="text-app-fg">{lowStockThreshold}</strong></span>
                    <span className="hidden sm:inline">Alert &lt; <strong className="text-app-fg">{lowStockThreshold}</strong> units</span>
                  </span>
                </button>
                {canIntake && (
                  <Link
                    to="/admin/shipments/receive"
                    prefetch="intent"
                    className="btn-primary btn-sm flex-1 sm:flex-initial whitespace-nowrap inline-flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    <span className="sm:hidden">Shipment</span>
                    <span className="hidden sm:inline">Receive Shipment</span>
                  </Link>
                )}
                {canExport && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1 sm:flex-initial whitespace-nowrap"
                    onClick={() => setShowExportModal(true)}
                  >
                    <span className="sm:hidden">Report</span>
                    <span className="hidden sm:inline">Generate report</span>
                  </Button>
                )}
              </div>
            }
            sheet={({ closeSheet }) => (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-12 w-full justify-center"
                  disabled={!canEditLowStock}
                  onClick={() => {
                    if (canEditLowStock) {
                      closeSheet();
                      setShowThresholdModal(true);
                    }
                  }}
                >
                  Alert &lt; <strong className="text-app-fg">{lowStockThreshold}</strong> units
                </Button>
                {canIntake && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-12 w-full justify-center"
                    onClick={() => {
                      closeSheet();
                      window.location.href = '/admin/shipments/receive';
                    }}
                  >
                    Receive Shipment
                  </Button>
                )}
                {canExport && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-12 w-full justify-center"
                    onClick={() => {
                      closeSheet();
                      setShowExportModal(true);
                    }}
                  >
                    Generate report
                  </Button>
                )}
              </>
            )}
          />
        }
      />
      {levelsLoadError && <RouteFetchErrorBanner messages={[levelsLoadError]} variant="danger" />}
      {movementsLoadError && (
        <RouteFetchErrorBanner messages={[movementsLoadError]} variant="warning" />
      )}
      <ExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        config={EXPORT_CONFIGS.inventory}
        initialFilters={{
          productId: serverProductFilter || undefined,
          locationId: serverLocationFilter || undefined,
          shipmentId: serverShipmentFilter || undefined,
          search: serverSearch || undefined,
          sort: serverSort === 'default' ? undefined : serverSort,
        }}
      />

      {/* Adjust modal — signed ADJUSTMENT movement + reason (supplier receipts use Shipments → verify). */}
      {canAdjust && editingLevel && adjustDirection && (
        <Modal
          open
          onClose={closeAdjustModal}
          maxWidth="max-w-md"
          contentClassName="p-6 space-y-4 bg-app-elevated"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-app-fg">
                {adjustDirection === 'decrease' ? 'Reconcile stock (remove)' : 'Reconcile stock (add)'}
              </h3>
              <p className="text-sm text-app-fg-muted mt-1 truncate">
                {productName(editingLevel.productId)} · {locationName(editingLevel.locationId)}
              </p>
              <p className="text-xs text-app-fg-muted mt-1">
                On hand: <span className="font-medium text-app-fg">{editingLevel.stockCount}</span> · Reserved:{' '}
                {editingLevel.reservedCount} · Available:{' '}
                <span className="font-medium text-app-fg">{editingLevel.stockCount - editingLevel.reservedCount}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={closeAdjustModal}
              aria-label="Close"
              className="p-1.5 rounded-lg text-app-fg-muted hover:bg-app-hover transition-colors shrink-0"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {adjustDirection === 'increase' && (
            <InlineNotification
              variant="info"
              message={
                canIntake
                  ? 'Received goods from a supplier? Record a shipment under Shipments and verify it — that creates FIFO batches with landed cost.'
                  : 'Received goods from a supplier? Ask someone with intake access to receive a shipment under Shipments and verify it.'
              }
              actions={
                canIntake
                  ? [
                      {
                        label: 'Receive shipment',
                        onClick: () => {
                          closeAdjustModal();
                          goToReceiveShipment();
                        },
                      },
                    ]
                  : undefined
              }
            />
          )}
          <ModalFetcherInlineError message={adjustSurface.errorMatchingIntent('adjustStock')} />
          <adjustFetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="adjustStock" />
            <input type="hidden" name="productId" value={editingLevel.productId} />
            <input type="hidden" name="locationId" value={editingLevel.locationId} />
            <input type="hidden" name="adjustmentQuantity" value={signedAdjustmentQuantityStr} />
            <RadioGroup<AdjustDirection>
              name="adjustDirection"
              label="Reconciliation type"
              required
              layout="card"
              value={adjustDirection}
              onChange={(v) => setAdjustDirection(v)}
              options={[
                {
                  value: 'decrease',
                  label: 'Reduction',
                  description: 'Digital stock is higher than physical count',
                },
                {
                  value: 'increase',
                  label: 'Addition',
                  description: 'Digital stock is lower than physical count',
                },
              ]}
            />
            <TextInput
              label={adjustDirection === 'decrease' ? 'Units to reduce by' : 'Units to add'}
              id="adjust-qty-display"
              type="number"
              required
              min={1}
              max={adjustDirection === 'decrease' ? editingLevel.stockCount : undefined}
              placeholder="1"
              value={adjustQty}
              onChange={(e) => setAdjustQty(e.target.value)}
              hint={
                adjustDirection === 'decrease'
                  ? `Reconciles on-hand stock downward (max ${editingLevel.stockCount}). Creates an ADJUSTMENT movement. Not a FIFO batch.`
                  : 'Reconciles on-hand stock upward (count fix only). New supplier stock must use Receive Shipment → verify.'
              }
            />
            <Textarea
              label="Reason"
              id="adjust-reason"
              name="reason"
              rows={3}
              required
              placeholder="Why is this adjustment needed? (min 10 characters)"
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-app-border">
              <Button type="button" variant="secondary" onClick={closeAdjustModal}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  !signedAdjustmentQuantityStr ||
                  adjustReason.trim().length < 10 ||
                  adjustFetcher.state !== 'idle'
                }
                loading={adjustFetcher.state !== 'idle'}
                loadingText={adjustDirection === 'decrease' ? 'Reconciling…' : 'Reconciling…'}
              >
                {adjustDirection === 'decrease' ? 'Reconcile (reduction)' : 'Reconcile (addition)'}
              </Button>
            </div>
          </adjustFetcher.Form>
        </Modal>
      )}

      {/* Low-stock threshold modal — admin-only.
       *  Two tiers: org-wide default (top) + per-location overrides (table).
       *  A location row with NULL `lowStockThreshold` inherits the org-wide value;
       *  any number set in its row wins for that location only. */}
      {canEditLowStock && showThresholdModal && (
        <Modal
          open
          onClose={() => setShowThresholdModal(false)}
          maxWidth="max-w-2xl"
          contentClassName="p-6 space-y-5 bg-app-elevated"
        >
          <div>
            <h3 className="text-lg font-semibold text-app-fg">Low-stock alerts</h3>
            <p className="text-sm text-app-fg-muted mt-1">
              SuperAdmins, Admins, and Stock Managers get notified when available stock at
              any location drops below its threshold. Rate-limited to one alert per location
              per 6 hours.
            </p>
          </div>

          <ModalFetcherInlineError message={bulkThresholdSurface.rawError} />

          {/* Org-wide default */}
          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-app-fg">Org-wide default</h4>
            <div className="flex items-center gap-2">
              <NumberInput
                id="low-stock-threshold-input"
                min={1}
                max={10000}
                fallbackValue={1}
                value={draftThreshold}
                onValueChange={setDraftThreshold}
                wrapperClassName="w-28"
                disabled={!canEditGlobalThreshold}
              />
              <span className="text-xs text-app-fg-muted">units</span>
              {!canEditGlobalThreshold && (
                <span className="text-xs text-app-fg-muted">Admin only</span>
              )}
              {globalChanged && (
                <span className="text-xs text-brand-600 dark:text-brand-400 font-medium">Changed</span>
              )}
            </div>
          </section>

          {/* Per-location overrides — all inputs always editable */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="text-sm font-semibold text-app-fg">Per-location &amp; product overrides</h4>
              <span className="text-xs text-app-fg-muted">
                Leave blank to inherit default. {locationChanges.length > 0 && (
                  <span className="text-brand-600 dark:text-brand-400 font-medium">
                    {locationChanges.length} changed
                  </span>
                )}
              </span>
            </div>
            {locationThresholds.length === 0 ? (
              <EmptyState
                variant="card"
                title="No active locations yet"
                description="Add a 3PL or warehouse first, then come back to set per-location alerts."
              />
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-md border border-app-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-app-elevated text-xs uppercase tracking-wide text-app-fg-muted">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Location</th>
                      <th className="text-left font-medium px-3 py-2">Products</th>
                      <th className="text-right font-medium px-3 py-2 w-32">Threshold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locationThresholds.map((loc) => {
                      const draft = locationDrafts.get(loc.id);
                      const serverVal = loc.lowStockThreshold; // number | null
                      // Display value: override if set, otherwise the current global draft.
                      const displayVal = typeof draft === 'number' ? draft : draftThreshold;
                      const isInheriting = draft === '' || draft === undefined;
                      // Changed = different from what the server has.
                      const changed =
                        (isInheriting && serverVal != null) ||
                        (typeof draft === 'number' && draft !== serverVal);
                      return (
                        <tr
                          key={loc.id}
                          className="border-t border-app-border align-middle"
                        >
                          <td className="px-3 py-1.5 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-app-fg truncate text-xs">{loc.name}</span>
                              {loc.providerKind === 'WAREHOUSE' ? (
                                <span
                                  className="inline-block h-2 w-2 shrink-0 rounded-full bg-brand-600 dark:bg-brand-500"
                                  title="Our warehouse"
                                  aria-label="Our warehouse"
                                />
                              ) : loc.providerName ? (
                                <span
                                  className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-micro font-medium whitespace-nowrap ${locationTagClasses(loc.providerKind)}`}
                                >
                                  {loc.providerName}
                                </span>
                              ) : null}
                              {changed && (
                                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" title="Changed" />
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-1.5 min-w-0">
                            {(() => {
                              const names = productsAtLocation.get(loc.id);
                              if (!names || names.length === 0) {
                                return <span className="text-micro text-app-fg-muted italic">No stock</span>;
                              }
                              return (
                                <span className="text-micro text-app-fg-muted truncate block max-w-[12rem]" title={names.join(', ')}>
                                  {names.join(', ')}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <NumberInput
                                id={`loc-threshold-${loc.id}`}
                                min={1}
                                max={10000}
                                fallbackValue={draftThreshold}
                                value={displayVal}
                                onValueChange={(v) => {
                                  // If the user types the same value as the global default,
                                  // treat it as "inherit" (no override stored).
                                  updateLocationDraft(loc.id, v === draftThreshold ? '' : v);
                                }}
                                wrapperClassName="w-24 inline-block"
                              />
                              {isInheriting && (
                                <span className="text-micro text-app-fg-muted whitespace-nowrap" title="Using org-wide default">
                                  default
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-app-border">
            <span className="text-xs text-app-fg-muted">
              {hasAnyChange
                ? `${(globalChanged ? 1 : 0) + locationChanges.length} change${(globalChanged ? 1 : 0) + locationChanges.length > 1 ? 's' : ''} to save`
                : 'No changes'}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowThresholdModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!hasAnyChange || bulkThresholdFetcher.state !== 'idle'}
                loading={bulkThresholdFetcher.state !== 'idle'}
                loadingText="Saving…"
                onClick={handleBulkSave}
              >
                Save all
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Peek modal — mobile card tap shows row details + actions */}
      {peekLevel && (
        <Modal
          open
          onClose={() => setPeekLevel(null)}
          maxWidth="max-w-sm"
          contentClassName="p-5 space-y-4 bg-app-elevated"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-app-fg leading-snug">
                {productName(peekLevel.productId)}
              </h3>
              <p className="text-sm text-app-fg-muted mt-0.5 truncate">
                {locationName(peekLevel.locationId)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPeekLevel(null)}
              aria-label="Close"
              className="p-1.5 rounded-lg text-app-fg-muted hover:bg-app-hover transition-colors shrink-0"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Status */}
          <div>
            {isEmptyLocationRow(peekLevel.id) ? (
              <StatusBadge status="Low stock" />
            ) : (() => {
              const avail = peekLevel.stockCount - peekLevel.reservedCount;
              return <StatusBadge status={avail < lowStockThreshold ? 'Low stock' : peekLevel.status} />;
            })()}
          </div>

          {/* Stock figures */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border border-app-border bg-app-bg p-2.5">
              <p className="text-xs text-app-fg-muted">Stock</p>
              <p className="text-lg font-semibold tabular-nums text-app-fg">{peekLevel.stockCount}</p>
            </div>
            <div className="rounded-lg border border-app-border bg-app-bg p-2.5">
              <p className="text-xs text-app-fg-muted">Reserved</p>
              <p className="text-lg font-semibold tabular-nums text-warning-600 dark:text-warning-400">{peekLevel.reservedCount}</p>
            </div>
            <div className="rounded-lg border border-app-border bg-app-bg p-2.5">
              <p className="text-xs text-app-fg-muted">Available</p>
              <p className={`text-lg font-semibold tabular-nums ${
                (peekLevel.stockCount - peekLevel.reservedCount) < lowStockThreshold
                  ? 'text-danger-600 dark:text-danger-400'
                  : 'text-success-600 dark:text-success-400'
              }`}>
                {peekLevel.stockCount - peekLevel.reservedCount}
              </p>
            </div>
          </div>

          {/* Shipment references */}
          {((peekLevel.shipmentLayers ?? []).length > 0 || peekLevel.hasManualFifoRemaining) && (
            <div>
              <p className="text-xs font-medium text-app-fg-muted mb-1.5">Shipment (FIFO)</p>
              <div className="flex flex-wrap gap-1.5">
                {(peekLevel.shipmentLayers ?? []).map((s) =>
                  canReadShipments ? (
                    <Link
                      key={s.id}
                      to={`/admin/shipments/${s.id}`}
                      prefetch="intent"
                      className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline whitespace-nowrap"
                      onClick={() => setPeekLevel(null)}
                    >
                      {s.referenceLabel}
                    </Link>
                  ) : (
                    <span key={s.id} className="text-xs font-medium text-app-fg-muted whitespace-nowrap">
                      {s.referenceLabel}
                    </span>
                  ),
                )}
                {peekLevel.hasManualFifoRemaining && (
                  <span className="text-xs rounded px-1.5 py-0.5 border border-app-border bg-app-hover text-app-fg-muted whitespace-nowrap">
                    Manual intake
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-app-border">
            {!isEmptyLocationRow(peekLevel.id) && (
              <Link
                to={`/admin/inventory/${peekLevel.id}`}
                prefetch="intent"
                className="btn-primary btn-sm flex-1 text-center"
                onClick={() => setPeekLevel(null)}
              >
                View details
              </Link>
            )}
            {canAdjust && !isEmptyLocationRow(peekLevel.id) && (
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={() => {
                  const lvl = peekLevel;
                  setPeekLevel(null);
                  openAdjustModal(lvl);
                }}
              >
                Reconcile
              </Button>
            )}
          </div>
        </Modal>
      )}

      {/* Overview stats — stock posture for the current filtered result set. */}
      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Total Stock', value: totalStock.toLocaleString(), valueClassName: 'text-app-fg' },
          { label: 'Reserved', value: totalReserved.toLocaleString(), valueClassName: 'text-warning-600 dark:text-warning-400' },
          {
            label: 'Available',
            value: (totalStock - totalReserved).toLocaleString(),
            valueClassName: 'text-success-600 dark:text-success-400',
          },
          { label: 'Locations', value: totalLocations.toLocaleString(), valueClassName: 'text-app-fg' },
        ]}
      />

      {/* Low-stock alerts — always visible inline when there are alerts */}
      {activeTab === 'levels' && resolvedAlerts && resolvedAlerts.items.length > 0 && (
        <LowStockAlertsCard alerts={resolvedAlerts} />
      )}

      {/* Tabs directly under the overview stats (stock levels plus optional inventory sub-views). */}
      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as TabValue)}
        tabs={[
          { value: 'levels', label: `Stock Levels (${totalLevels})` },
          ...(hasTransfers ? [{ value: 'transfers' as const, label: `Transfers (${(transfers ?? []).length})` }] : []),
          ...(hasReturns ? [{ value: 'returns' as const, label: `Returns (${(returnedOrders ?? []).length})` }] : []),
          ...(reconciliations != null ? [{ value: 'reconciliation' as const, label: 'Reconciliation' }] : []),
        ]}
      />

      {/* Content */}
      {activeTab === 'levels' && (
        <>
        {/* Filter + search + sort — mobile: collapsible sheet; desktop: inline row. */}
        {(() => {
          const hasActiveFilters =
            currentProductFilter !== 'ALL' ||
            currentLocationFilter !== 'ALL' ||
            !!serverProviderFilter ||
            currentShipmentFilter !== 'ALL' ||
            serverSortBy !== 'updatedAt' ||
            serverSortDir !== 'desc' ||
            !!serverSearch;
          const filterBadgeCount =
            (currentProductFilter !== 'ALL' ? 1 : 0) +
            (currentLocationFilter !== 'ALL' ? 1 : 0) +
            (serverProviderFilter ? 1 : 0) +
            (currentShipmentFilter !== 'ALL' ? 1 : 0) +
            (serverSortBy !== 'updatedAt' || serverSortDir !== 'desc' ? 1 : 0);

          if (totalLevels === 0 && !hasActiveFilters) return null;

          const productSelect = (
            <div className="relative">
              {currentProductFilter !== 'ALL' && (
                <FilterDismiss onClear={() => updateLevelsParam('productId', '')} />
              )}
              <SearchableSelect
                id="levels-product-filter"
                value={currentProductFilter}
                onChange={(v) => updateLevelsParam('productId', v)}
                wrapperClassName="w-full md:w-48"
                placeholder="All products"
                searchPlaceholder="Search products..."
                options={[
                  { value: 'ALL', label: 'All products' },
                  ...products.map((p: ProductOption) => ({ value: p.id, label: p.name })),
                ]}
              />
            </div>
          );
          const locationSelect = (
            <div className="relative">
              {currentLocationFilter !== 'ALL' && (
                <FilterDismiss onClear={() => updateLevelsParam('locationId', '')} />
              )}
              <SearchableSelect
                id="levels-location-filter"
                value={currentLocationFilter}
                onChange={(v) => updateLevelsParam('locationId', v)}
                wrapperClassName="w-full md:w-48"
                placeholder="All locations"
                searchPlaceholder="Search locations..."
                options={[
                  { value: 'ALL', label: 'All locations' },
                  ...(displayLocations.length > 0 ? displayLocations : locations).map((l: LocationOption) => ({
                    value: l.id,
                    label: l.name,
                    ...(l.providerKind === 'WAREHOUSE'
                      ? {
                          leading: (
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full bg-brand-600 dark:bg-brand-500"
                              title="Our warehouse"
                              aria-label="Our warehouse"
                            />
                          ),
                        }
                      : l.providerName
                        ? {
                            leading: (
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-micro font-medium whitespace-nowrap ${locationTagClasses(l.providerKind)}`}
                              >
                                {l.providerName}
                              </span>
                            ),
                          }
                        : {}),
                  })),
                ]}
              />
            </div>
          );
          const shipmentSelect = (
            <div className="relative">
              {currentShipmentFilter !== 'ALL' && (
                <FilterDismiss onClear={() => updateLevelsParam('shipmentId', '')} />
              )}
              <SearchableSelect
                id="levels-shipment-filter"
                value={currentShipmentFilter}
                onChange={(v) => updateLevelsParam('shipmentId', v)}
                wrapperClassName="w-full md:w-52"
                placeholder="All shipments"
                searchPlaceholder="Search SHIP ref…"
                options={[
                  { value: 'ALL', label: 'All shipments' },
                  ...shipmentOptions.map((shipment) => ({
                    value: shipment.id,
                    label: shipment.label,
                  })),
                ]}
              />
            </div>
          );
          const sortMenu = (
            <SortMenu
              value={{ sortBy: serverSortBy, sortDir: serverSortDir }}
              onChange={(next) =>
                updateLevelsSort(
                  next.sortBy as 'available' | 'updatedAt',
                  next.sortDir,
                )
              }
              defaultValue={{ sortBy: 'updatedAt', sortDir: 'desc' }}
              options={[
                {
                  value: 'updatedAt',
                  label: 'Last updated',
                  description: 'Most recently changed inventory rows.',
                  ascLabel: 'Oldest first',
                  descLabel: 'Newest first',
                  defaultDir: 'desc',
                },
                {
                  value: 'available',
                  label: 'Available units',
                  description: 'Stock count minus units reserved on open orders.',
                  ascLabel: 'Lowest first',
                  descLabel: 'Highest first',
                  defaultDir: 'desc',
                },
              ]}
            />
          );
          const resetBtn = hasActiveFilters ? (
            <button
              type="button"
              onClick={resetLevelsFilters}
              className="text-xs text-brand-600 dark:text-brand-400 hover:underline self-center shrink-0"
            >
              Reset
            </button>
          ) : null;

          return (
            <ToolbarFiltersCollapsible
              hideMobileSheet
              badgeCount={filterBadgeCount}
              searchRow={
                <form
                  method="get"
                  className="flex min-w-0 flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitSearch(searchInput);
                  }}
                >
                  <SearchInput
                    name="search"
                    placeholder="Search by product name…"
                    value={searchInput}
                    onChange={(val) => {
                      setSearchInput(val);
                      if (val === '') submitSearch('');
                    }}
                    withSubmitButton
                    wrapperClassName="w-full"
                  />
                </form>
              }
              desktopInlineFilters={
                <>
                  {productSelect}
                  {locationSelect}
                  {serverProviderFilter && (
                    <div className="relative flex items-center rounded-md border border-app-border bg-app-hover px-3 h-9">
                      <FilterDismiss onClear={() => updateLevelsParam('providerId', '')} />
                      <span className="text-xs text-app-fg-muted whitespace-nowrap">Filtered by company</span>
                    </div>
                  )}
                  {shipmentSelect}
                  {sortMenu}
                  {resetBtn}
                </>
              }
              sheetFilterBody={null}
            />
          );
        })()}
        <CompactTable<InventoryLevel>
          columnVisibilityKey="admin.inventory.levels"
          columns={levelColumns}
          rows={levels}
          rowKey={(r) => r.id}
          rowHref={(level) => isOptimisticId(level.id) || isEmptyLocationRow(level.id) ? undefined : `/admin/inventory/${level.id}`}
          rowClassName={(level) => (isOptimisticId(level.id) ? 'opacity-60' : '')}
          loading={isLoadingLevels}
          loadingVariant="overlay"
          emptyTitle={
            levelsLoadError
              ? 'Unable to load stock levels'
              : levels.length === 0
                ? 'No inventory data yet'
                : 'No inventory matches your filter'
          }
          emptyDescription={
            levelsLoadError
              ? 'Use Reload data above or refresh the page. Empty totals here do not mean you have no stock.'
              : levels.length === 0
                ? 'Add products, then receive supplier stock from the Shipments page and verify it to post into inventory.'
                : 'Try changing filters (product, location, shipment) or sort.'
          }
          renderMobileCard={(level) => {
            const available = level.stockCount - level.reservedCount;
            const isLow = available < lowStockThreshold;
            const isEmpty = isEmptyLocationRow(level.id);
            const isOptimistic = isOptimisticId(level.id);
            return (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setPeekLevel(level)}
                  className="-mx-3 -mt-2.5 block w-[calc(100%+1.5rem)] px-3 pt-2.5 pb-1 space-y-1.5 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm font-medium truncate ${isEmpty ? 'text-app-fg-muted italic' : 'text-app-fg'}`}>
                      {productName(level.productId)}
                    </span>
                    <span className={`text-sm font-semibold tabular-nums shrink-0 ${isLow ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                      {available} avail
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-app-fg-muted">
                    <span className="truncate">{locationName(level.locationId)}</span>
                    <span className="shrink-0 tabular-nums">Stock: {level.stockCount}</span>
                  </div>
                </button>
                {!isEmpty && !isOptimistic && (
                  <div className="flex items-center gap-2 border-t border-app-border pt-2 -mx-3 px-3 -mb-0.5">
                    <Link to={`/admin/inventory/${level.id}`} prefetch="intent" className="text-xs font-medium text-brand-600 dark:text-brand-400" onClick={(e) => e.stopPropagation()}>
                      View
                    </Link>
                    {canAdjust && (
                      <button type="button" className="text-xs font-medium text-brand-600 dark:text-brand-400" onClick={(e) => { e.stopPropagation(); openAdjustModal(level); }}>
                        Reconcile
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          }}
        />

        {/* Pagination — server-side, drives `page` URL param. */}
        {levelsTotalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-sm text-app-fg-muted">
              {totalLevels > 0
                ? `Showing ${(levelsPage - 1) * levelsLimit + 1}–${Math.min(levelsPage * levelsLimit, totalLevels)} of ${totalLevels} rows`
                : 'No rows'}
            </p>
            <Pagination page={levelsPage} totalPages={levelsTotalPages} pageParam="page" pageSize={levelsLimit} pageSizeParam="perPage" />
          </div>
        )}
        </>
      )}

      {activeTab === 'transfers' && hasTransfers && (
        <TransfersTab
          transfers={transfers}
          products={products}
          locations={locations}
          routeLoaderBusy={isLoadingLevels}
        />
      )}

      {activeTab === 'returns' && hasReturns && (
        <ReturnsTab
          returnedOrders={returnedOrders}
          locationsWithLock={locationsWithLock ?? []}
          fetcher={fetcher}
        />
      )}

      {activeTab === 'reconciliation' && reconciliations != null && (
        <ReconciliationTab
          reconciliations={reconciliations}
          products={products}
          locations={locations}
          locationsWithLock={locationsWithLock ?? []}
          fetcher={fetcher}
        />
      )}

    </div>
  );
}

/* ── Transfers Tab ── */

function TransfersTab({
  transfers,
  products,
  locations,
  routeLoaderBusy = false,
}: {
  transfers: Transfer[];
  products: ProductOption[];
  locations: LocationOption[];
  routeLoaderBusy?: boolean;
}) {
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'No stock received';
  const locationName = (id: string) => {
    const loc = locations.find((l) => l.id === id);
    if (!loc) return 'Unknown location';
    return loc.providerName && loc.providerName !== 'Our warehouses' ? `${loc.name} ● ${loc.providerName}` : loc.name;
  };
  const formatRecordedAt = (dateIso: string) =>
    new Date(dateIso).toLocaleDateString('en-NG', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const columns: CompactTableColumn<Transfer>[] = [
    {
      key: 'product',
      header: 'Product',
      hideable: false,
      render: (t) => <span className="font-medium text-app-fg">{productName(t.productId)}</span>,
      minWidth: 'min-w-[160px]',
    },
    {
      key: 'from',
      header: 'From',
      render: (t) => <span className="text-app-fg-muted">{locationName(t.fromLocationId)}</span>,
      hideOnMobile: true,
    },
    {
      key: 'to',
      header: 'To',
      render: (t) => <span className="text-app-fg-muted">{locationName(t.toLocationId)}</span>,
      hideOnMobile: true,
    },
    {
      key: 'route',
      header: 'Route',
      className: 'sm:hidden',
      render: (t) => (
        <span className="text-xs text-app-fg-muted">
          {locationName(t.fromLocationId)} → {locationName(t.toLocationId)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      hideOnMobile: true,
      render: (t) => <StatusBadge status={t.transferStatus} showDot />,
    },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      render: (t) => (
        <span className="font-medium tabular-nums text-app-fg">{t.quantityReceived ?? t.quantitySent}</span>
      ),
    },
    {
      key: 'recorded',
      header: 'Recorded',
      hideOnMobile: true,
      render: (t) => (
        <span className="text-xs sm:text-sm text-app-fg-muted whitespace-nowrap">
          {formatRecordedAt(t.verifiedAt ?? t.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="card p-4 sm:p-6">
      <CompactTable<Transfer>
        columnVisibilityKey="admin.inventory.transfers"
        caption="Stock transfers"
        columns={columns}
        rows={transfers}
        rowKey={(t) => t.id}
        loading={routeLoaderBusy}
        loadingVariant="overlay"
        emptyTitle="No transfers yet"
        emptyDescription="Record and manage transfers from Admin → Transfers."
        withCard={false}
        className="overflow-hidden rounded-xl border border-app-border"
      />
    </div>
  );
}

/* ── Returns Tab ── */

function ReturnsTab({
  returnedOrders,
  locationsWithLock,
  fetcher,
}: {
  returnedOrders: ReturnedOrder[];
  locationsWithLock: LocationWithLock[];
  fetcher: ReturnType<typeof useFetcher>;
}) {
  const [writeOffOrderId, setWriteOffOrderId] = useState<string | null>(null);
  const returnsSurface = useFetcherActionSurface(fetcher);

  // Close write-off modal on success — edge-triggered via the shared hook.
  // Replaces the prior in-render `if (actionSuccess) setWriteOffOrderId(null)`
  // (a setState-during-render anti-pattern). See CLAUDE.md → "Modal +
  // Optimistic UI Pattern".
  const handleWriteOffSuccess = useCallback(() => {
    setWriteOffOrderId(null);
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleWriteOffSuccess);

  const locationName = useCallback((id: string | null) => {
    if (!id) return '\u2014';
    return locationsWithLock.find((l) => l.id === id)?.name ?? 'Unknown location';
  }, [locationsWithLock]);

  const returnsColumns = useMemo((): CompactTableColumn<ReturnedOrder>[] => [
    {
      key: 'orderId',
      header: 'Order ID',
      hideable: false,
      render: (order) => <OrderIdBadge id={order.id} orderNumber={order.orderNumber} textClassName="font-mono text-sm text-app-fg-muted" />,
      minWidth: 'min-w-[120px]',
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (order) => <span className="font-medium text-app-fg">{order.customerName}</span>,
    },
    {
      key: 'location',
      header: 'Location',
      hideOnMobile: true,
      render: (order) => <span className="text-app-fg-muted">{locationName(order.logisticsLocationId)}</span>,
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (order) => (
        <span className="text-sm text-app-fg-muted max-w-[200px] truncate" title={order.deliveryNotes ?? undefined}>
          {order.deliveryNotes ?? '\u2014'}
        </span>
      ),
      cellTitle: (order) => order.deliveryNotes ?? undefined,
    },
    {
      key: 'date',
      header: 'Date',
      nowrap: true,
      render: (order) => (
        <span className="text-app-fg-muted text-sm">
          {new Date(order.updatedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      tight: true,
      nowrap: true,
      hideable: false,
      minWidth: 'min-w-[11rem]',
      mobileShowLabel: false,
      render: (order) => (
        <CompactTableActions className="justify-end shrink-0">
          <fetcher.Form method="post" className="inline">
            <input type="hidden" name="intent" value="restock" />
            <input type="hidden" name="orderId" value={order.id} />
            <Button
              type="submit"
              variant="success"
              size="sm"
              className="text-xs"
              disabled={fetcher.state === 'submitting'}
              loading={fetcher.state === 'submitting'}
              loadingText="Restocking..."
              title="Mark as sellable. Add to local 3PL stock."
            >
              Sellable
            </Button>
          </fetcher.Form>
          <TableActionButton variant="danger" onClick={() => setWriteOffOrderId(order.id)} title="Mark as damaged. Write off as operational loss.">
            Damaged
          </TableActionButton>
        </CompactTableActions>
      ),
    },
  ], [fetcher.state, locationName]);

  const lockedLocations = locationsWithLock.filter((l) => l.dispatchLocked);

  return (
    <>
      {/* Dispatch Lock Alert */}
      {lockedLocations.length > 0 && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span className="text-sm font-semibold text-danger-700 dark:text-danger-400">Dispatch Locked</span>
          </div>
          <p className="text-sm text-danger-600 dark:text-danger-500">
            Dispatch is locked at: {lockedLocations.map((l) => l.name).join(', ')}.
            Resolve pending reconciliations to unlock.
          </p>
        </div>
      )}

      {/* Write-off modal */}
      {writeOffOrderId && (
        <Modal open onClose={() => setWriteOffOrderId(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
            <ModalFetcherInlineError message={returnsSurface.errorMatchingIntent('writeOff')} />
            <h3 className="text-lg font-semibold text-app-fg">Write Off: Damaged Item</h3>
            <p className="text-sm text-app-fg-muted">This will permanently mark the item as damaged and log it as an Operational Loss.</p>
            <fetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="writeOff" />
              <input type="hidden" name="orderId" value={writeOffOrderId} />
              <Textarea
                label="Damage Note"
                name="reason"
                required
                minLength={10}
                rows={3}
                placeholder="Describe the damage (min 10 characters)..."
              />
              <div className="flex gap-2">
                <Button type="submit" variant="danger" size="sm" loading={fetcher.state === 'submitting'} loadingText="Writing off...">Write Off</Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setWriteOffOrderId(null)}>Cancel</Button>
              </div>
            </fetcher.Form>
        </Modal>
      )}

      {/* Returns table */}
      <div className="list-panel">
        <CompactTable<ReturnedOrder>
          columnVisibilityKey="admin.inventory.returns"
          caption="Returned orders"
          columns={returnsColumns}
          rows={returnedOrders}
          rowKey={(order) => order.id}
          withCard={false}
          className="min-w-[860px]"
          emptyTitle="No returned items pending assessment"
          renderMobileCard={(order) => (
            <div className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-app-fg text-sm">{order.customerName}</span>
                <StatusBadge status="RETURNED" />
              </div>
              <p className="text-sm text-app-fg-muted">
                {locationName(order.logisticsLocationId)} · {new Date(order.updatedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
              </p>
              <div className="flex flex-nowrap items-center gap-2 pt-1 overflow-x-auto">
                <fetcher.Form method="post" className="inline shrink-0">
                  <input type="hidden" name="intent" value="restock" />
                  <input type="hidden" name="orderId" value={order.id} />
                  <Button type="submit" variant="success" size="sm" className="text-xs" loading={fetcher.state === 'submitting'} loadingText="Updating...">Sellable</Button>
                </fetcher.Form>
                <Button variant="danger" size="sm" className="text-xs shrink-0" onClick={() => setWriteOffOrderId(order.id)}>Damaged</Button>
              </div>
            </div>
          )}
        />
      </div>
    </>
  );
}

/* ── Reconciliation Tab ── */

function ReconciliationTab({
  reconciliations,
  products,
  locations,
  locationsWithLock,
  fetcher,
}: {
  reconciliations: Promise<Reconciliation[]> | Reconciliation[];
  products: ProductOption[];
  locations: LocationOption[];
  locationsWithLock: LocationWithLock[];
  fetcher: ReturnType<typeof useFetcher>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [reconciliationLocationId, setReconciliationLocationId] = useState('');
  const [reconciliationProductId, setReconciliationProductId] = useState('');

  // Close reconciliation modal on success — edge-triggered, replaces the
  // prior in-render `if (actionSuccess) setShowForm(false)` anti-pattern.
  const handleReconciliationSuccess = useCallback(() => {
    setShowForm(false);
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleReconciliationSuccess);

  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? 'Unknown location';
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'No stock received';
  const activeLocations = locationsWithLock.filter((l) => l.status === 'ACTIVE');

  const reconciliationColumns = useMemo((): CompactTableColumn<Reconciliation>[] => [
    {
      key: 'location',
      header: 'Location',
      render: (r) => <span className="font-medium text-app-fg">{locationName(r.locationId)}</span>,
      minWidth: 'min-w-[140px]',
    },
    {
      key: 'product',
      header: 'Product',
      render: (r) => <span className="text-app-fg-muted">{productName(r.productId)}</span>,
    },
    {
      key: 'digital',
      header: 'Digital',
      align: 'right',
      render: (r) => <span className="font-medium">{r.digitalCount}</span>,
    },
    {
      key: 'physical',
      header: 'Physical',
      align: 'right',
      render: (r) => <span className="font-medium">{r.physicalCount}</span>,
    },
    {
      key: 'discrepancy',
      header: 'Discrepancy',
      align: 'right',
      render: (r) => (
        <span
          className={
            r.discrepancy < 0
              ? 'font-bold text-danger-600 dark:text-danger-400'
              : r.discrepancy > 0
                ? 'font-bold text-success-600 dark:text-success-400'
                : 'font-bold'
          }
        >
          {r.discrepancy > 0 ? '+' : ''}
          {r.discrepancy}
        </span>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (r) => <span className="text-sm">{REASON_LABELS[r.reasonCode] ?? r.reasonCode}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge status={r.reconciliationStatus} />,
    },
    {
      key: 'date',
      header: 'Date',
      nowrap: true,
      render: (r) => (
        <span className="text-app-fg-muted text-sm">
          {new Date(r.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
      ),
    },
  ], [locations, products]);

  return (
    <>
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (showForm) {
              setShowForm(false);
            } else {
              setReconciliationLocationId('');
              setReconciliationProductId('');
              setShowForm(true);
            }
          }}
        >
          {showForm ? 'Close' : '+ Stock Reconciliation'}
        </Button>
      </div>

      {/* Reconciliation Form */}
      <ResponsiveFormPanel
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setReconciliationLocationId('');
          setReconciliationProductId('');
        }}
      >
        <fetcher.Form method="post" className="card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-app-fg">Stock Reconciliation Report</h3>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setReconciliationLocationId('');
                setReconciliationProductId('');
              }}
              className="text-app-fg-muted hover:text-app-fg"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <input type="hidden" name="intent" value="createReconciliation" />
          <input type="hidden" name="locationId" value={reconciliationLocationId} />
          <input type="hidden" name="productId" value={reconciliationProductId} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SearchableSelect
              id="reconciliation-location"
              label="Location"
              required
              value={reconciliationLocationId}
              onChange={setReconciliationLocationId}
              placeholder="Select location..."
              searchPlaceholder="Search locations..."
              options={activeLocations.map((l) => ({
                value: l.id,
                label: l.name,
                disabled: l.dispatchLocked,
                description: l.dispatchLocked ? 'Dispatch locked' : undefined,
              }))}
            />
            <SearchableSelect
              id="reconciliation-product"
              label="Product"
              required
              value={reconciliationProductId}
              onChange={setReconciliationProductId}
              placeholder="Select product..."
              searchPlaceholder="Search products..."
              options={products.map((p) => ({ value: p.id, label: p.name }))}
            />
            <TextInput
              label="Physical Count (actual units on shelf)"
              name="physicalCount"
              type="number"
              min={0}
              required
              placeholder="Actual count"
            />
            <FormSelect
              label="Reason Code"
              name="reasonCode"
              required
              options={[
                { value: 'DAMAGED', label: 'Damaged' },
                { value: 'LOST', label: 'Lost' },
                { value: 'EXPIRED', label: 'Expired' },
                { value: 'THEFT', label: 'Suspected Theft' },
                { value: 'COUNTING_ERROR', label: 'Counting Error' },
                { value: 'OTHER', label: 'Other' },
              ]}
            />
          </div>
          <Textarea
            label="Notes (min 10 characters)"
            name="notes"
            rows={2}
            minLength={10}
            placeholder="Describe the discrepancy..."
          />
          <div className="bg-warning-50 dark:bg-warning-700/10 border border-warning-200 dark:border-warning-700/30 rounded-lg px-3 py-2">
            <p className="text-xs text-warning-700 dark:text-warning-400">
              If the physical count differs from the digital record, dispatch will be LOCKED at this location until the reconciliation is approved.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={
                !reconciliationLocationId ||
                !reconciliationProductId ||
                activeLocations.find((l) => l.id === reconciliationLocationId)?.dispatchLocked === true
              }
              loading={fetcher.state === 'submitting'}
              loadingText="Submitting..."
            >
              Submit Reconciliation
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowForm(false);
                setReconciliationLocationId('');
                setReconciliationProductId('');
              }}
            >
              Cancel
            </Button>
          </div>
        </fetcher.Form>
      </ResponsiveFormPanel>

      {/* Reconciliation Table */}
      <DeferredSection resolve={reconciliations} fallback={<ReconciliationTableDeferredFallback />}>
        {(resolved) => {
          const rows = resolved as Reconciliation[];
          return (
            <div className="list-panel">
              <CompactTable<Reconciliation>
                caption="Stock reconciliations"
                columns={reconciliationColumns}
                rows={rows}
                rowKey={(r) => r.id}
                withCard={false}
                className="min-w-[960px]"
                emptyTitle="No reconciliation records"
                emptyDescription="Submit a report when physical stock differs from system records."
                renderMobileCard={(r) => (
                  <div className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-app-fg text-sm">{locationName(r.locationId)}</span>
                      <StatusBadge status={r.reconciliationStatus} />
                    </div>
                    <p className="text-sm text-app-fg-muted">{productName(r.productId)} · {REASON_LABELS[r.reasonCode] ?? r.reasonCode}</p>
                    <div className="flex gap-4 text-sm">
                      <span>Digital: <strong>{r.digitalCount}</strong></span>
                      <span>Physical: <strong>{r.physicalCount}</strong></span>
                      <span className={r.discrepancy < 0 ? 'text-danger-600 dark:text-danger-400 font-bold' : 'text-success-600 dark:text-success-400 font-bold'}>
                        {r.discrepancy > 0 ? '+' : ''}{r.discrepancy}
                      </span>
                    </div>
                  </div>
                )}
              />
            </div>
          );
        }}
      </DeferredSection>
    </>
  );
}
