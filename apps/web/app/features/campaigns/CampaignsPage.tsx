import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, Link } from '@remix-run/react';
import { useToast } from '~/components/ui/toast';
import { BranchScopedLink } from '~/components/ui/branch-scoped-link';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { StatusBadge } from '~/components/ui/status-badge';
import { Tabs } from '~/components/ui/tabs';
import { EmptyState } from '~/components/ui/empty-state';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { SearchInput } from '~/components/ui/search-input';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import type { Campaign, CampaignFormConfig, FormsPageProps } from './types';

function isOptionOn(value: boolean | string | undefined): boolean {
  return value === true || value === 'true';
}

function FormOptionsSummary({ config }: { config: CampaignFormConfig | null }) {
  if (!config) return null;

  const hasCustomText =
    config.heading || config.subtitle || config.buttonText || config.accentColor;
  const optionalFields: { label: string; on: boolean }[] = [
    { label: 'Delivery Address', on: isOptionOn(config.showDeliveryAddress) },
    { label: 'Delivery notes', on: isOptionOn(config.showDeliveryNotes) },
    { label: 'Delivery state', on: isOptionOn(config.showDeliveryState) },
    { label: 'Gender', on: isOptionOn(config.showGender) },
    { label: 'Preferred date', on: isOptionOn(config.showPreferredDeliveryDate) },
    { label: 'Email', on: isOptionOn(config.showCustomerEmail) },
    { label: 'Payment method', on: isOptionOn(config.showPaymentMethod) },
  ].filter((f) => f.on);

  if (!hasCustomText && optionalFields.length === 0) return null;

  return (
    <div className="space-y-2">
      {hasCustomText && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-app-fg-muted">
          {config.heading && (
            <span className="truncate max-w-full" title={config.heading}>
              <span className="font-medium text-app-fg-muted">Heading:</span> {config.heading}
            </span>
          )}
          {config.subtitle && (
            <span className="truncate max-w-full" title={config.subtitle}>
              <span className="font-medium text-app-fg-muted">Subtitle:</span> {config.subtitle}
            </span>
          )}
          {config.buttonText && (
            <span>
              <span className="font-medium text-app-fg-muted">Button:</span> {config.buttonText}
            </span>
          )}
          {config.accentColor && (
            <span className="inline-flex items-center gap-1.5">
              <span className="font-medium text-app-fg-muted">Accent:</span>
              <span
                className="w-3.5 h-3.5 rounded-full border border-app-border shrink-0"
                style={{ backgroundColor: config.accentColor }}
                title={config.accentColor}
              />
              <span className="font-mono text-app-fg-muted">{config.accentColor}</span>
            </span>
          )}
        </div>
      )}
      {optionalFields.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {optionalFields.map((f) => (
            <span
              key={f.label}
              className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-app-hover text-app-fg-muted"
            >
              {f.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Icons (24x24, consistent) ──────────────
const ViewIcon = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.06a4.5 4.5 0 00-1.242-7.244l4.5-4.5a4.5 4.5 0 116.364 6.364l-1.757 1.757" />
  </svg>
);

const EditIcon = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
  </svg>
);

const DuplicateIcon = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m11.25 6.875h-3.375a1.125 1.125 0 01-1.125-1.125v-3.375" />
  </svg>
);

type DeploymentCopySection = 'hosted' | 'iframe' | 'shadow';

const CheckIconSm = (
  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

// ── Main Component ───────────────────────────────────
export function FormsPage({
  forms,
  totalForms,
  products = [],
  isMediaBuyer = false,
  showMediaBuyerColumn = false,
  currentUserName: _currentUserName,
  currentUserId,
}: FormsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  /** URL: no/`all` → all forms (non-MB); `mine` → my forms. */
  const navFormsScope: 'all' | 'mine' = isMediaBuyer || tabParam === 'mine' ? 'mine' : 'all';

  const setMainNavTab = useCallback(
    (v: 'all' | 'mine') => {
      // Avoid Remix navigation/refetch on tab switch. We still keep the URL in sync
      // for shareability using History API.
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      if (v === 'all') url.searchParams.delete('tab');
      else url.searchParams.set('tab', v);
      window.history.replaceState({}, '', url.pathname + url.search);
    },
    [],
  );

  /** Product filter — client-side over the loaded forms, URL-synced (`?productId`)
   *  via History API so it shares the tab's no-refetch behaviour. */
  const [productFilter, setProductFilter] = useState(() => searchParams.get('productId') ?? '');
  const applyProductFilter = useCallback((value: string) => {
    setProductFilter(value);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (value) url.searchParams.set('productId', value);
    else url.searchParams.delete('productId');
    window.history.replaceState({}, '', url.pathname + url.search);
  }, []);

  /** Name search — client-side over the loaded forms, URL-synced (`?search`). */
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') ?? '');
  const applySearch = useCallback((value: string) => {
    setSearchQuery(value);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (value.trim()) url.searchParams.set('search', value);
    else url.searchParams.delete('search');
    window.history.replaceState({}, '', url.pathname + url.search);
  }, []);

  const allForms = forms as Campaign[];
  const mineFormsCount = currentUserId ? allForms.filter((c) => c.mediaBuyerId === currentUserId).length : 0;
  const allFormsCount = allForms.length;

  const navTabValue: 'all' | 'mine' = navFormsScope === 'mine' ? 'mine' : 'all';

  // Local UI tab state so the tab/content switches immediately (same tick),
  // without triggering a loader refetch.
  const [uiTabValue, setUiTabValue] = useState<'all' | 'mine'>(navTabValue);
  useEffect(() => {
    setUiTabValue(navTabValue);
  }, [navTabValue]);

  const uiFormsScope: 'all' | 'mine' = isMediaBuyer || uiTabValue === 'mine' ? 'mine' : 'all';

  const [deploymentModal, setDeploymentModal] = useState<Campaign | null>(null);
  const [deploymentCopiedSection, setDeploymentCopiedSection] = useState<DeploymentCopySection | null>(null);
  const deploymentCopyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Forms list slice for the active scope (server already scopes MB to own campaigns). */
  const displayedForms = useMemo(() => {
    let list = forms as Campaign[];
    if (uiFormsScope === 'mine' && currentUserId) {
      list = list.filter((c) => c.mediaBuyerId === currentUserId);
    }
    if (productFilter) {
      list = list.filter(
        (c) => Array.isArray(c.productIds) && c.productIds.includes(productFilter),
      );
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.mediaBuyerName ?? '').toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q),
      );
    }
    return list;
  }, [forms, uiFormsScope, currentUserId, productFilter, searchQuery]);

  const showMyFormsOnly = uiFormsScope === 'mine';

  const { toast } = useToast();
  const SAVED_TOAST_KEY = 'yannis-forms-saved-toast';
  const clearedSavedRef = useRef(false);
  useEffect(() => {
    if (searchParams.get('saved') === '1') {
      if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(SAVED_TOAST_KEY)) {
        sessionStorage.setItem(SAVED_TOAST_KEY, '1');
        toast.success('Saved successfully');
      }
      if (!clearedSavedRef.current) {
        clearedSavedRef.current = true;
        const next = new URLSearchParams(searchParams);
        next.delete('saved');
        setSearchParams(next, { replace: true });
      }
    } else {
      clearedSavedRef.current = false;
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SAVED_TOAST_KEY);
    }
  }, [searchParams, setSearchParams, toast]);

  const edgeWorkerUrl = ((typeof window !== 'undefined' ? window.__ENV?.EDGE_WORKER_URL : '') || '').replace(/\/+$/, '');

  // Embed snippets — both auto-size to the form's content so the host page
  // never gets an inner scrollbar (iframe) or dead space under the submit
  // button (shadow DOM). The iframe variant points at `/iframe/:id` (which
  // broadcasts `yannis-form-resize`) and ships a tiny listener that applies
  // the height. The shadow variant injects into a dedicated, campaign-scoped
  // `#yannis-form-:id` div that shrinks to the form rather than the host
  // funnel section it was pasted into.
  const iframeSnippet = deploymentModal
    ? `<iframe id="yannis-frame-${deploymentModal.id}" src="${edgeWorkerUrl}/iframe/${deploymentModal.id}" width="100%" height="600" frameBorder="0" scrolling="no" style="border:0;width:100%"></iframe>\n<script>(function(){var f=document.getElementById("yannis-frame-${deploymentModal.id}");window.addEventListener("message",function(e){if(f&&e.data&&e.data.type==="yannis-form-resize"&&typeof e.data.height==="number"){f.style.height=e.data.height+"px";}});})();</script>`
    : '';
  const shadowSnippet = deploymentModal
    ? `<div id="yannis-form-${deploymentModal.id}"></div><script src="${edgeWorkerUrl}/embed.js?campaign=${deploymentModal.id}"></script>`
    : '';

  useEffect(() => {
    if (!deploymentModal) {
      setDeploymentCopiedSection(null);
      if (deploymentCopyResetRef.current) {
        clearTimeout(deploymentCopyResetRef.current);
        deploymentCopyResetRef.current = null;
      }
    }
  }, [deploymentModal]);

  const copyDeploymentSnippet = useCallback((text: string, section: DeploymentCopySection) => {
    void navigator.clipboard.writeText(text).then(() => {
      if (deploymentCopyResetRef.current) {
        clearTimeout(deploymentCopyResetRef.current);
      }
      setDeploymentCopiedSection(section);
      deploymentCopyResetRef.current = setTimeout(() => {
        setDeploymentCopiedSection(null);
        deploymentCopyResetRef.current = null;
      }, 2200);
    });
  }, []);

  // Sync UI tab with back/forward navigation (URL changes outside Remix navigation).
  useEffect(() => {
    const onPopState = () => {
      const url = new URL(window.location.href);
      const t = url.searchParams.get('tab');
      const next: 'all' | 'mine' = t === 'mine' ? 'mine' : 'all';
      setUiTabValue(next);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          showMyFormsOnly ? 'My Forms' : 'Forms'
        }
        mobileInlineActions
        description={
          showMyFormsOnly
              ? 'Manage your campaign forms.'
              : 'Manage campaign forms.'
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Forms toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <BranchScopedLink
                  to="/admin/marketing/forms/new"
                  actionLabel="creating a form"
                  prefetch="intent"
                >
                  <Button variant="primary" size="sm">
                    + New Form
                  </Button>
                </BranchScopedLink>
              </>
            }
            sheet={
              <BranchScopedLink
                to="/admin/marketing/forms/new"
                actionLabel="creating a form"
                prefetch="intent"
                className="block"
              >
                <Button variant="primary" size="sm" className="h-12 w-full justify-center">
                  + New Form
                </Button>
              </BranchScopedLink>
            }
          />
        }
      />

      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Total Forms', value: totalForms, valueClassName: 'text-app-fg' },
          {
            label: 'Active Forms',
            value: allForms.filter((c) => c.status === 'ACTIVE').length,
            valueClassName: 'text-success-600 dark:text-success-400',
          },
        ]}
      />

      <Tabs
        value={uiTabValue}
        onChange={(v) => {
          const next = v as 'all' | 'mine';
          setUiTabValue(next);
          setMainNavTab(next);
        }}
        tabs={
          isMediaBuyer
            ? [{ value: 'mine', label: `My forms (${mineFormsCount})` }]
            : [
                { value: 'all', label: `All forms (${allFormsCount})` },
                { value: 'mine', label: `My forms (${mineFormsCount})` },
              ]
        }
      />

      <div className="list-panel">
        <ToolbarFiltersCollapsible
          className="!border-0 !px-0 md:!px-4"
          hideMobileSheet
          badgeCount={(productFilter ? 1 : 0) + (searchQuery ? 1 : 0)}
          onClearAll={
            productFilter || searchQuery
              ? () => { applyProductFilter(''); applySearch(''); }
              : undefined
          }
          searchRow={
            <form
              className="min-w-0 flex-1"
              onSubmit={(e) => e.preventDefault()}
            >
              <SearchInput
                value={searchQuery}
                onChange={applySearch}
                placeholder="Search by name or ID…"
                withSubmitButton
                wrapperClassName="min-w-0 w-full flex-1 md:min-w-0"
              />
            </form>
          }
          desktopInlineFilters={
            products.length > 0 ? (
              <SearchableSelect
                id="forms-product-filter"
                value={productFilter}
                onChange={applyProductFilter}
                options={[
                  { value: '', label: 'All products' },
                  ...products.map((p) => ({ value: p.id, label: p.name })),
                ]}
                placeholder="All products"
                searchPlaceholder="Search products…"
                wrapperClassName="w-full min-w-0 sm:w-48"
              />
            ) : null
          }
          sheetFilterBody={
            products.length > 0 ? (
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Product</span>
                <SearchableSelect
                  id="forms-product-filter-mobile"
                  value={productFilter}
                  onChange={applyProductFilter}
                  options={[
                    { value: '', label: 'All products' },
                    ...products.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  placeholder="All products"
                  searchPlaceholder="Search products…"
                />
              </div>
            ) : <div />
          }
        />
      </div>

      <div className="relative">
        <>
      {/* Empty state hint: why you might not see forms */}
      {displayedForms.length === 0 && (
        <div className="rounded-lg bg-info-50 dark:bg-info-700/20 border border-info-200 dark:border-info-700/50 px-4 py-3">
          {productFilter || searchQuery.trim() ? (
            <p className="text-sm text-info-800 dark:text-info-200">
              No forms match your current search or filter.{' '}
              <button
                type="button"
                onClick={() => {
                  applyProductFilter('');
                  applySearch('');
                }}
                className="font-semibold text-brand-600 dark:text-brand-400 hover:underline"
              >
                Clear filters
              </button>{' '}
              to see all forms.
            </p>
          ) : isMediaBuyer ? (
            <p className="text-sm text-info-800 dark:text-info-200">
              You don&apos;t have any forms yet. Only forms you create appear here. Use{' '}
              <BranchScopedLink
                to="/admin/marketing/forms/new"
                actionLabel="creating a form"
                className="font-semibold text-brand-600 dark:text-brand-400 hover:underline"
              >
                + New Form
              </BranchScopedLink>{' '}
              to create one.
            </p>
          ) : uiFormsScope === 'mine' ? (
            <p className="text-sm text-info-800 dark:text-info-200">
              No forms in this view. You&apos;re viewing <strong>My forms</strong> — switch to the <strong>All forms</strong> tab above to see forms created by other users.
            </p>
          ) : (
            <p className="text-sm text-info-800 dark:text-info-200">
              No forms yet. Use{' '}
              <BranchScopedLink
                to="/admin/marketing/forms/new"
                actionLabel="creating a form"
                className="font-semibold text-brand-600 dark:text-brand-400 hover:underline"
              >
                + New Form
              </BranchScopedLink>{' '}
              to create one.
            </p>
          )}
        </div>
      )}

      {/* ── Forms Cards ───────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {displayedForms.map((c) => (
          <article
            key={c.id}
            className="group relative bg-app-elevated rounded-xl border border-app-border p-5 shadow-sm hover:shadow-md hover:border-app-border transition-all duration-200 flex flex-col min-h-[180px]"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <h3 className="font-semibold text-app-fg text-base leading-snug line-clamp-2 min-w-0 flex-1">
                {c.name}
              </h3>
              <StatusBadge status={c.status} className="shrink-0" />
            </div>

            <div className="text-sm text-app-fg-muted mb-4 flex-1">
              {showMediaBuyerColumn && c.mediaBuyerId && (
                <>
                  <Link
                    to={`/hr/users/${c.mediaBuyerId}`}
                    className="text-brand-600 dark:text-brand-400 hover:underline font-medium"
                  >
                    {c.mediaBuyerName ?? 'View user'}
                  </Link>
                  <span className="mx-1.5">·</span>
                </>
              )}
              <time dateTime={c.createdAt}>
                {new Date(c.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
              </time>
            </div>

            {c.formConfig && (c.formConfig.heading || c.formConfig.subtitle || c.formConfig.buttonText || c.formConfig.accentColor || isOptionOn(c.formConfig.showDeliveryAddress) || isOptionOn(c.formConfig.showDeliveryNotes) || isOptionOn(c.formConfig.showDeliveryState) || isOptionOn(c.formConfig.showGender) || isOptionOn(c.formConfig.showPreferredDeliveryDate) || isOptionOn(c.formConfig.showCustomerEmail) || isOptionOn(c.formConfig.showPaymentMethod)) && (
              <div className="mb-4 pt-3 border-t border-app-border">
                <p className="text-xs font-medium text-app-fg-muted dark:text-app-fg-muted uppercase tracking-wider mb-2">Form options</p>
                <FormOptionsSummary config={c.formConfig} />
              </div>
            )}

            <div className="flex items-center gap-2 pt-3 border-t border-app-border">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setDeploymentModal(c)}
                className="gap-1.5 shrink-0"
              >
                {ViewIcon}
                <span>View</span>
              </Button>
              <BranchScopedLink
                to={`/admin/marketing/forms/${c.id}/edit`}
                actionLabel="editing this form"
                prefetch="intent"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-app-fg-muted hover:text-app-fg hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors duration-150"
              >
                {EditIcon}
                <span>Edit</span>
              </BranchScopedLink>
              <BranchScopedLink
                to={`/admin/marketing/forms/new?duplicateFrom=${c.id}`}
                actionLabel="duplicating this form"
                prefetch="intent"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-app-fg-muted hover:text-app-fg hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors duration-150"
              >
                {DuplicateIcon}
                <span>Duplicate</span>
              </BranchScopedLink>
            </div>
          </article>
        ))}
        {displayedForms.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              title="No forms yet"
              description="Use + New Form in the header to create your first form."
            />
          </div>
        )}
      </div>
        </>
      </div>

      {/* ── Deployment Modal ──────────────────────────── */}
      {deploymentModal && (
        <Modal open onClose={() => setDeploymentModal(null)} maxWidth="max-w-lg" contentClassName="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-app-fg">
                Deployment: {deploymentModal.name}
              </h3>
              <button onClick={() => setDeploymentModal(null)} className="text-app-fg-muted hover:text-app-fg">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {!edgeWorkerUrl && (
                <div className="rounded-lg bg-warning-50 dark:bg-warning-700/20 border border-warning-200 dark:border-warning-700/50 px-4 py-3">
                  <p className="text-sm font-medium text-warning-700 dark:text-warning-400">Edge Worker URL not configured</p>
                  <p className="text-xs text-warning-600 dark:text-warning-400 mt-0.5">
                    Set <code className="font-mono bg-warning-100 dark:bg-warning-800/40 px-1 rounded">EDGE_WORKER_URL</code> in <code className="font-mono bg-warning-100 dark:bg-warning-800/40 px-1 rounded">apps/web/.env</code> to generate real deployment URLs.
                  </p>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Hosted URL</label>
                  <button
                    type="button"
                    onClick={() =>
                      copyDeploymentSnippet(`${edgeWorkerUrl}/form/${deploymentModal.id}`, 'hosted')
                    }
                    className={`inline-flex items-center gap-1 text-xs font-medium transition-colors duration-200 ${
                      deploymentCopiedSection === 'hosted'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-brand-500 hover:text-brand-600'
                    }`}
                  >
                    {deploymentCopiedSection === 'hosted' ? (
                      <>
                        {CheckIconSm}
                        Copied
                      </>
                    ) : (
                      'Copy'
                    )}
                  </button>
                </div>
                <div
                  className={`mt-1 p-3 bg-app-hover rounded-lg transition-[box-shadow,ring-color] duration-300 ${
                    deploymentCopiedSection === 'hosted'
                      ? 'ring-2 ring-emerald-500/45 shadow-sm'
                      : 'ring-2 ring-transparent'
                  }`}
                >
                  <code className="text-sm text-brand-600 dark:text-brand-400 break-all">
                    {edgeWorkerUrl}/form/{deploymentModal.id}
                  </code>
                </div>
                <p className="text-xs text-app-fg-muted mt-1">
                  Share this URL directly with customers or use as a landing page.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">iFrame Embed</label>
                  <button
                    type="button"
                    onClick={() => copyDeploymentSnippet(iframeSnippet, 'iframe')}
                    className={`inline-flex items-center gap-1 text-xs font-medium transition-colors duration-200 ${
                      deploymentCopiedSection === 'iframe'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-brand-500 hover:text-brand-600'
                    }`}
                  >
                    {deploymentCopiedSection === 'iframe' ? (
                      <>
                        {CheckIconSm}
                        Copied
                      </>
                    ) : (
                      'Copy'
                    )}
                  </button>
                </div>
                <div
                  className={`mt-1 p-3 bg-app-hover rounded-lg transition-[box-shadow,ring-color] duration-300 ${
                    deploymentCopiedSection === 'iframe'
                      ? 'ring-2 ring-emerald-500/45 shadow-sm'
                      : 'ring-2 ring-transparent'
                  }`}
                >
                  <code className="text-xs text-app-fg-muted break-all whitespace-pre-wrap">
                    {iframeSnippet}
                  </code>
                </div>
                <p className="text-xs text-app-fg-muted mt-1">
                  Embed the form as an iframe on any website or landing page.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Shadow DOM Snippet</label>
                  <button
                    type="button"
                    onClick={() => copyDeploymentSnippet(shadowSnippet, 'shadow')}
                    className={`inline-flex items-center gap-1 text-xs font-medium transition-colors duration-200 ${
                      deploymentCopiedSection === 'shadow'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-brand-500 hover:text-brand-600'
                    }`}
                  >
                    {deploymentCopiedSection === 'shadow' ? (
                      <>
                        {CheckIconSm}
                        Copied
                      </>
                    ) : (
                      'Copy'
                    )}
                  </button>
                </div>
                <div
                  className={`mt-1 p-3 bg-app-hover rounded-lg transition-[box-shadow,ring-color] duration-300 ${
                    deploymentCopiedSection === 'shadow'
                      ? 'ring-2 ring-emerald-500/45 shadow-sm'
                      : 'ring-2 ring-transparent'
                  }`}
                >
                  <code className="text-xs text-app-fg-muted break-all">
                    {shadowSnippet}
                  </code>
                </div>
                <p className="text-xs text-app-fg-muted mt-1">
                  Inject the form into any page via Shadow DOM — isolated from parent styles.
                </p>
              </div>
            </div>

            <Button variant="secondary" size="sm" className="w-full" onClick={() => setDeploymentModal(null)}>
              Close
            </Button>
        </Modal>
      )}

    </div>
  );
}
