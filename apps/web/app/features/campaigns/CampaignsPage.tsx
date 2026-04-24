import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useFetcher, useSearchParams, useRevalidator, Link } from '@remix-run/react';
import { useFetcherToast, useToast } from '~/components/ui/toast';
import { PageNotification } from '~/components/ui/page-notification';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Modal } from '~/components/ui/modal';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { ResponsiveFormPanel } from '~/components/ui/responsive-form-panel';
import { Checkbox } from '~/components/ui/checkbox';
import { PageHeader } from '~/components/ui/page-header';
import { StatusBadge } from '~/components/ui/status-badge';
import { Tabs } from '~/components/ui/tabs';
import { EmptyState } from '~/components/ui/empty-state';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
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

const ActivateIcon = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const DeactivateIcon = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ArchiveIcon = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
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
  totalForms: _totalForms,
  products,
  productsLoadError = null,
  isMediaBuyer = false,
  showMediaBuyerColumn = false,
  currentUserName: _currentUserName,
  currentUserId,
}: FormsPageProps) {
  const fetcher = useFetcher();
  const statusFetcher = useFetcher();
  const { revalidate } = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAddForm, setShowAddForm] = useState(false);
  const [deploymentModal, setDeploymentModal] = useState<Campaign | null>(null);
  const [deploymentCopiedSection, setDeploymentCopiedSection] = useState<DeploymentCopySection | null>(null);
  const deploymentCopyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingForm, setEditingForm] = useState<Campaign | null>(null);
  /** Pending confirm for Deactivate or Archive (opens ConfirmActionModal) */
  const [confirmAction, setConfirmAction] = useState<{ type: 'deactivate' | 'archive'; id: string; name: string } | null>(null);

  /** Client-side tab: 'all' | 'mine'. Only relevant when !isMediaBuyer (HoM/SuperAdmin). */
  const [viewMode, setViewMode] = useState<'all' | 'mine'>('all');

  /** Forms to display: all from server, or filtered to current user when viewMode === 'mine'. */
  const displayedForms = useMemo(() => {
    if (isMediaBuyer || !currentUserId) return forms as Campaign[];
    if (viewMode === 'mine') return (forms as Campaign[]).filter((c) => c.mediaBuyerId === currentUserId);
    return forms as Campaign[];
  }, [forms, isMediaBuyer, currentUserId, viewMode]);

  const showMyFormsOnly = isMediaBuyer || viewMode === 'mine';

  const actionError = (fetcher.data as { error?: string })?.error;
  const actionSuccess = (fetcher.data as { success?: boolean })?.success;
  const [dismissedError, setDismissedError] = useState(false);
  const [dismissedProductsError, setDismissedProductsError] = useState(false);
  useFetcherToast(fetcher.data, { successMessage: 'Saved successfully' });
  useFetcherToast(statusFetcher.data, { successMessage: 'Status updated' });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  useEffect(() => {
    if (productsLoadError) setDismissedProductsError(false);
  }, [productsLoadError]);

  // Close confirm modal (deactivate/archive) when statusFetcher returns success
  useEffect(() => {
    if (statusFetcher.state === 'idle' && statusFetcher.data) {
      const result = statusFetcher.data as { success?: boolean };
      if (result.success && confirmAction) {
        setConfirmAction(null);
      }
    }
  }, [statusFetcher.state, statusFetcher.data]);

  // Close Edit Form modal (and Add Form panel) when fetcher returns success
  useEffect(() => {
    if (actionSuccess && fetcher.state === 'idle') {
      setEditingForm(null);
      setShowAddForm(false);
      revalidate();
    }
  }, [actionSuccess, fetcher.state, revalidate]);

  const { toast } = useToast();
  const SAVED_TOAST_KEY = 'yannis-forms-saved-toast';
  const clearedSavedRef = useRef(false);
  useEffect(() => {
    if (searchParams.get('saved') === '1') {
      if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(SAVED_TOAST_KEY)) {
        sessionStorage.setItem(SAVED_TOAST_KEY, '1');
        toast.success('Saved successfully');
      }
      setShowAddForm(false);
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

  const handleStatusChange = useCallback((id: string, status: string) => {
    const formData = new FormData();
    formData.set('intent', 'updateForm');
    formData.set('id', id);
    formData.set('status', status);
    statusFetcher.submit(formData, { method: 'post' });
  }, [statusFetcher]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={showMyFormsOnly ? 'My Forms' : 'Forms'}
        description={
          showMyFormsOnly
            ? 'Create and manage your order forms'
            : 'Create and manage order forms for your products'
        }
        actions={
          <Button variant="primary" size="sm" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? 'Close' : '+ New Form'}
          </Button>
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

      {productsLoadError && !dismissedProductsError && (
        <PageNotification
          variant="error"
          message={productsLoadError}
          durationMs={8000}
          onDismiss={() => setDismissedProductsError(true)}
        />
      )}

      {/* Empty state hint: why you might not see forms */}
      {displayedForms.length === 0 && (
        <div className="rounded-lg bg-info-50 dark:bg-info-700/20 border border-info-200 dark:border-info-700/50 px-4 py-3">
          {isMediaBuyer ? (
            <p className="text-sm text-info-800 dark:text-info-200">
              You don&apos;t have any forms yet. Only forms you create appear here. Use <strong>+ New Form</strong> to create one.
            </p>
          ) : viewMode === 'mine' ? (
            <p className="text-sm text-info-800 dark:text-info-200">
              No forms in this view. You&apos;re viewing <strong>My forms</strong> — switch to the <strong>All forms</strong> tab above to see forms created by other users.
            </p>
          ) : (
            <p className="text-sm text-info-800 dark:text-info-200">
              No forms yet. Use <strong>+ New Form</strong> to create one.
            </p>
          )}
        </div>
      )}

      <DeferredSection resolve={products} fallback={<OverviewStatStripSkeleton count={3} />}>
        {(resolvedProducts) => (
          <OverviewStatStrip
            items={[
              { label: 'Total Forms', value: displayedForms.length, valueClassName: 'text-app-fg' },
              {
                label: 'Active Forms',
                value: displayedForms.filter((c) => c.status === 'ACTIVE').length,
                valueClassName: 'text-success-600 dark:text-success-400',
              },
              { label: 'Products', value: resolvedProducts.length, valueClassName: 'text-app-fg' },
            ]}
          />
        )}
      </DeferredSection>

      {/* Add Form */}
      <ResponsiveFormPanel open={showAddForm} onClose={() => setShowAddForm(false)}>
        <fetcher.Form method="post" className="card space-y-3">
          <h3 className="text-lg font-semibold text-app-fg">New Form</h3>
          <input type="hidden" name="intent" value="createForm" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextInput name="name" required placeholder="Form name" />
            <DeferredSection resolve={products} skeleton="inline">
              {(resolvedProducts) => (
                <FormSelect
                  name="productId"
                  required
                  options={resolvedProducts.map((p) => ({
                    value: p.id,
                    label: `${p.name} (₦${Number(p.baseSalePrice).toLocaleString()})`,
                  }))}
                  placeholder="Select product..."
                />
              )}
            </DeferredSection>
          </div>
          <div className="border-t border-app-border pt-3">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mb-2">
              Form Customization (Optional)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextInput name="formHeading" placeholder="Form heading (default: Place Your Order)" />
              <TextInput name="formSubtitle" placeholder="Form subtitle" />
              <TextInput name="formButtonText" placeholder="Button text (default: Submit Order)" />
              <div className="flex items-center gap-2">
                <input name="formAccentColor" type="color" defaultValue="#6366f1" className="w-10 h-9 rounded border border-app-border cursor-pointer" />
                <span className="text-sm text-app-fg-muted">Accent color</span>
              </div>
            </div>
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mt-4 mb-2">
              Optional Form Fields
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showDeliveryAddress" defaultChecked={false} />
                <span className="text-sm text-app-fg-muted">Delivery Address</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showDeliveryNotes" defaultChecked={false} />
                <span className="text-sm text-app-fg-muted">Delivery Notes</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showDeliveryState" defaultChecked={false} />
                <span className="text-sm text-app-fg-muted">Delivery State</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showGender" defaultChecked={false} />
                <span className="text-sm text-app-fg-muted">Gender</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showPreferredDeliveryDate" defaultChecked={false} />
                <span className="text-sm text-app-fg-muted">Preferred Delivery Date</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showPaymentMethod" defaultChecked={false} />
                <span className="text-sm text-app-fg-muted">Payment method (Pay on delivery / Pay online)</span>
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Creating...">
              Create Form
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
          </div>
        </fetcher.Form>
      </ResponsiveFormPanel>

      {/* All / Mine tabs (HoM/SuperAdmin only — Media Buyer always sees own forms) */}
      {!isMediaBuyer && currentUserId && (
        <Tabs
          value={viewMode}
          onChange={(v) => setViewMode(v as typeof viewMode)}
          tabs={[
            { value: 'all', label: `All forms (${(forms as Campaign[]).length})` },
            { value: 'mine', label: `My forms (${(forms as Campaign[]).filter((c) => c.mediaBuyerId === currentUserId).length})` },
          ]}
        />
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

            {c.formConfig && (c.formConfig.heading || c.formConfig.subtitle || c.formConfig.buttonText || c.formConfig.accentColor || isOptionOn(c.formConfig.showDeliveryAddress) || isOptionOn(c.formConfig.showDeliveryNotes) || isOptionOn(c.formConfig.showDeliveryState) || isOptionOn(c.formConfig.showGender) || isOptionOn(c.formConfig.showPreferredDeliveryDate) || isOptionOn(c.formConfig.showPaymentMethod)) && (
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
              <button
                type="button"
                onClick={() => setEditingForm(c)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-app-fg-muted hover:text-app-fg hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors duration-150 cursor-pointer"
              >
                {EditIcon}
                <span>Edit</span>
              </button>
              {c.status === 'ACTIVE' && (
                <button
                  type="button"
                  onClick={() => setConfirmAction({ type: 'deactivate', id: c.id, name: c.name })}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-warning-600 dark:text-warning-400 hover:bg-warning-50 dark:hover:bg-warning-900/20 rounded-lg transition-colors duration-150 cursor-pointer"
                >
                  {DeactivateIcon}
                  <span>Deactivate</span>
                </button>
              )}
              {c.status === 'INACTIVE' && (
                <button
                  type="button"
                  onClick={() => handleStatusChange(c.id, 'ACTIVE')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-success-600 dark:text-success-400 hover:bg-success-50 dark:hover:bg-success-900/20 rounded-lg transition-colors duration-150 cursor-pointer"
                >
                  {ActivateIcon}
                  <span>Activate</span>
                </button>
              )}
              {c.status !== 'ARCHIVED' && (
                <button
                  type="button"
                  onClick={() => setConfirmAction({ type: 'archive', id: c.id, name: c.name })}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20 rounded-lg transition-colors duration-150 cursor-pointer"
                >
                  {ArchiveIcon}
                  <span>Archive</span>
                </button>
              )}
            </div>
          </article>
        ))}
        {displayedForms.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              title="No forms yet"
              description="Create one with + New Form above."
            />
          </div>
        )}
      </div>

      {/* ── Edit Form Modal ───────────────────────── */}
      {editingForm && (
        <Modal open onClose={() => setEditingForm(null)} maxWidth="max-w-lg" contentClassName="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-app-fg">Edit Form</h3>
              <button onClick={() => setEditingForm(null)} className="text-app-fg-muted hover:text-app-fg">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <fetcher.Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="updateForm" />
              <input type="hidden" name="id" value={editingForm.id} />
              <TextInput
                label="Form Name"
                name="name"
                defaultValue={editingForm.name}
              />
              <FormSelect
                label="Status"
                name="status"
                defaultValue={editingForm.status}
                options={[
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                  { value: 'ARCHIVED', label: 'Archived' },
                ]}
              />
              <div className="border-t border-app-border pt-3">
                <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mb-2">
                  Form Customization
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TextInput name="formHeading" placeholder="Form heading" defaultValue={editingForm.formConfig?.heading ?? ''} />
                  <TextInput name="formSubtitle" placeholder="Form subtitle" defaultValue={editingForm.formConfig?.subtitle ?? ''} />
                  <TextInput name="formButtonText" placeholder="Button text" defaultValue={editingForm.formConfig?.buttonText ?? ''} />
                  <div className="flex items-center gap-2">
                    <input name="formAccentColor" type="color" defaultValue={editingForm.formConfig?.accentColor ?? '#6366f1'} className="w-10 h-9 rounded border border-app-border cursor-pointer" />
                    <span className="text-sm text-app-fg-muted">Accent color</span>
                  </div>
                </div>
                <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mt-4 mb-2">
                  Optional Form Fields
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      name="showDeliveryAddress"
                      defaultChecked={editingForm.formConfig?.showDeliveryAddress === true || editingForm.formConfig?.showDeliveryAddress === 'true'}
                    />
                    <span className="text-sm text-app-fg-muted">Delivery Address</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      name="showDeliveryNotes"
                      defaultChecked={editingForm.formConfig?.showDeliveryNotes === true || editingForm.formConfig?.showDeliveryNotes === 'true'}
                    />
                    <span className="text-sm text-app-fg-muted">Delivery Notes</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      name="showDeliveryState"
                      defaultChecked={editingForm.formConfig?.showDeliveryState === true || editingForm.formConfig?.showDeliveryState === 'true'}
                    />
                    <span className="text-sm text-app-fg-muted">Delivery State</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      name="showGender"
                      defaultChecked={editingForm.formConfig?.showGender === true || editingForm.formConfig?.showGender === 'true'}
                    />
                    <span className="text-sm text-app-fg-muted">Gender</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      name="showPreferredDeliveryDate"
                      defaultChecked={editingForm.formConfig?.showPreferredDeliveryDate === true || editingForm.formConfig?.showPreferredDeliveryDate === 'true'}
                    />
                    <span className="text-sm text-app-fg-muted">Preferred Delivery Date</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      name="showPaymentMethod"
                      defaultChecked={editingForm.formConfig?.showPaymentMethod === true || editingForm.formConfig?.showPaymentMethod === 'true'}
                    />
                    <span className="text-sm text-app-fg-muted">Payment method (Pay on delivery / Pay online)</span>
                  </label>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="secondary" size="sm" onClick={() => setEditingForm(null)}>Cancel</Button>
                <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Saving...">
                  Save Changes
                </Button>
              </div>
            </fetcher.Form>
        </Modal>
      )}

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
                    onClick={() =>
                      copyDeploymentSnippet(
                        `<iframe src="${edgeWorkerUrl}/form/${deploymentModal.id}" width="100%" height="500" frameBorder="0"></iframe>`,
                        'iframe',
                      )
                    }
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
                  <code className="text-xs text-app-fg-muted break-all">
                    {`<iframe src="${edgeWorkerUrl}/form/${deploymentModal.id}" width="100%" height="500" frameBorder="0"></iframe>`}
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
                    onClick={() =>
                      copyDeploymentSnippet(
                        `<div id="yannis-form"></div><script src="${edgeWorkerUrl}/embed.js?campaign=${deploymentModal.id}"></script>`,
                        'shadow',
                      )
                    }
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
                    {`<div id="yannis-form"></div><script src="${edgeWorkerUrl}/embed.js?campaign=${deploymentModal.id}"></script>`}
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

      {/* Deactivate / Archive confirmation */}
      {confirmAction && (
        <ConfirmActionModal
          open={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          title={confirmAction.type === 'deactivate' ? 'Deactivate form?' : `Archive "${confirmAction.name}"?`}
          description={
            confirmAction.type === 'deactivate' ? (
              <>
                <strong>{confirmAction.name}</strong> will no longer be active. You can activate it again later.
              </>
            ) : (
              <>
                <strong>{confirmAction.name}</strong> will be hidden from default lists.
              </>
            )
          }
          details={
            confirmAction.type === 'archive' ? (
              <ul className="list-disc list-inside text-sm text-app-fg-muted space-y-1">
                <li>Hidden from default campaign lists</li>
                <li>You can change status back anytime</li>
              </ul>
            ) : undefined
          }
          confirmLabel={confirmAction.type === 'deactivate' ? 'Deactivate' : 'Archive'}
          variant={confirmAction.type === 'deactivate' ? 'warning' : 'archive'}
          loading={statusFetcher.state === 'submitting'}
          onConfirm={() => {
            if (confirmAction) {
              handleStatusChange(
                confirmAction.id,
                confirmAction.type === 'deactivate' ? 'INACTIVE' : 'ARCHIVED',
              );
            }
          }}
        />
      )}
    </div>
  );
}
