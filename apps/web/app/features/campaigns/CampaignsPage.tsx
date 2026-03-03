import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { Button } from '~/components/ui/button';
import { DeferredSection } from '~/components/ui/deferred-section';
import type { Campaign, FormsPageProps } from './types';

const DEPLOYMENT_LABELS: Record<string, string> = {
  HOSTED: 'Hosted URL',
  SNIPPET: 'Shadow DOM Snippet',
  IFRAME: 'iFrame Embed',
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'badge-success',
  INACTIVE: 'badge-warning',
  ARCHIVED: 'badge-danger',
};

// ── Icons ────────────────────────────────────────────
function EllipsisIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
    </svg>
  );
}

// ── Action Dropdown ──────────────────────────────────
interface DropdownItem {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  icon?: React.ReactNode;
}

function ActionDropdown({ items, id, openMenuId, setOpenMenuId }: {
  items: DropdownItem[];
  id: string;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOpen = openMenuId === id;
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!isOpen || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: rect.right,
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        btnRef.current && !btnRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, setOpenMenuId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = () => setOpenMenuId(null);
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen, setOpenMenuId]);

  const variantClasses: Record<string, string> = {
    default: 'text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700',
    success: 'text-success-600 dark:text-success-400 hover:bg-success-50 dark:hover:bg-success-900/20',
    warning: 'text-warning-600 dark:text-warning-400 hover:bg-warning-50 dark:hover:bg-warning-900/20',
    danger: 'text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20',
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpenMenuId(isOpen ? null : id)}
        className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-100 text-surface-600 hover:bg-surface-200 hover:text-surface-800 dark:bg-surface-700 dark:text-surface-300 dark:hover:bg-surface-600 dark:hover:text-white transition-colors"
      >
        <EllipsisIcon className="w-4 h-4" />
      </button>
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] w-48 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-lg shadow-lg py-1 animate-fade-in"
          style={{ top: pos.top, left: pos.left, transform: 'translateX(-100%)' }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => { item.onClick(); setOpenMenuId(null); }}
              className={`w-full text-left px-3 py-2 text-sm whitespace-nowrap flex items-center gap-2 transition-colors ${variantClasses[item.variant ?? 'default']}`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Inline SVG icons for dropdown items ──────────────
const EditIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
  </svg>
);

const DeployIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.06a4.5 4.5 0 00-1.242-7.244l4.5-4.5a4.5 4.5 0 116.364 6.364l-1.757 1.757" />
  </svg>
);

const ActivateIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const DeactivateIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ArchiveIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
  </svg>
);

// ── Main Component ───────────────────────────────────
export function FormsPage({
  forms,
  totalForms,
  products,
}: FormsPageProps) {
  const fetcher = useFetcher();
  const statusFetcher = useFetcher();
  const [showAddForm, setShowAddForm] = useState(false);
  const [deploymentModal, setDeploymentModal] = useState<Campaign | null>(null);
  const [editingForm, setEditingForm] = useState<Campaign | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const actionError = (fetcher.data as { error?: string })?.error;
  const actionSuccess = (fetcher.data as { success?: boolean })?.success;
  useFetcherToast(fetcher.data, { successMessage: 'Saved successfully' });
  useFetcherToast(statusFetcher.data, { successMessage: 'Status updated' });

  useEffect(() => {
    if (actionSuccess) {
      setShowAddForm(false);
      setEditingForm(null);
    }
  }, [actionSuccess]);

  const edgeWorkerUrl = (typeof window !== 'undefined' ? window.__ENV?.EDGE_WORKER_URL : '') || '';

  const handleStatusChange = useCallback((id: string, status: string) => {
    const formData = new FormData();
    formData.set('intent', 'updateForm');
    formData.set('id', id);
    formData.set('status', status);
    statusFetcher.submit(formData, { method: 'post' });
  }, [statusFetcher]);

  function getFormMenuItems(c: Campaign): DropdownItem[] {
    const items: DropdownItem[] = [
      { label: 'Deploy Links', onClick: () => setDeploymentModal(c), icon: DeployIcon },
      { label: 'Edit', onClick: () => setEditingForm(c), icon: EditIcon },
    ];
    if (c.status === 'ACTIVE') {
      items.push({ label: 'Deactivate', onClick: () => handleStatusChange(c.id, 'INACTIVE'), variant: 'warning', icon: DeactivateIcon });
    }
    if (c.status === 'INACTIVE') {
      items.push({ label: 'Activate', onClick: () => handleStatusChange(c.id, 'ACTIVE'), variant: 'success', icon: ActivateIcon });
    }
    if (c.status !== 'ARCHIVED') {
      items.push({ label: 'Archive', onClick: () => handleStatusChange(c.id, 'ARCHIVED'), variant: 'danger', icon: ArchiveIcon });
    }
    return items;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Forms</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
            Create and manage order forms for your products
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowAddForm(!showAddForm)}>
          + New Form
        </Button>
      </div>

      {actionError && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-700 dark:text-danger-500">{actionError}</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Total Forms</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{totalForms}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Active Forms</p>
          <p className="text-2xl font-bold text-success-600 dark:text-success-400 mt-1">
            {(forms as Campaign[]).filter((c) => c.status === 'ACTIVE').length}
          </p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Products</p>
          <DeferredSection resolve={products} skeleton="inline">
            {(resolvedProducts) => (
              <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{resolvedProducts.length}</p>
            )}
          </DeferredSection>
        </div>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <fetcher.Form method="post" className="card space-y-3">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">New Form</h3>
          <input type="hidden" name="intent" value="createForm" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input name="name" type="text" required placeholder="Form name" className="input" />
            <DeferredSection resolve={products} skeleton="inline">
              {(resolvedProducts) => (
                <select name="productId" required className="input">
                  <option value="">Select product...</option>
                  {resolvedProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} (&#8358;{Number(p.baseSalePrice).toLocaleString()})</option>
                  ))}
                </select>
              )}
            </DeferredSection>
            <select name="deploymentType" className="input">
              <option value="HOSTED">Hosted URL</option>
              <option value="SNIPPET">Shadow DOM Snippet</option>
              <option value="IFRAME">iFrame Embed</option>
            </select>
          </div>
          <div className="border-t border-surface-200 dark:border-surface-700 pt-3">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-2">
              Form Customization (Optional)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input name="formHeading" type="text" placeholder="Form heading (default: Place Your Order)" className="input" />
              <input name="formSubtitle" type="text" placeholder="Form subtitle" className="input" />
              <input name="formButtonText" type="text" placeholder="Button text (default: Submit Order)" className="input" />
              <div className="flex items-center gap-2">
                <input name="formAccentColor" type="color" defaultValue="#6366f1" className="w-10 h-9 rounded border border-surface-200 dark:border-surface-700 cursor-pointer" />
                <span className="text-sm text-surface-800 dark:text-surface-200">Accent color</span>
              </div>
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
      )}

      {/* ── Forms Table ───────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Form</th>
                <th className="table-header">Type</th>
                <th className="table-header">Status</th>
                <th className="table-header">Created</th>
                <th className="table-header w-10"></th>
              </tr>
            </thead>
            <tbody>
              {(forms as Campaign[]).map((c) => (
                <tr key={c.id} className="table-row">
                  <td className="table-cell font-medium text-surface-900 dark:text-surface-100">{c.name}</td>
                  <td className="table-cell text-surface-800 dark:text-surface-200">
                    {DEPLOYMENT_LABELS[c.deploymentType] ?? c.deploymentType}
                  </td>
                  <td className="table-cell">
                    <span className={STATUS_COLORS[c.status] ?? 'badge'}>{c.status}</span>
                  </td>
                  <td className="table-cell text-surface-800 dark:text-surface-200">
                    {new Date(c.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                  </td>
                  <td className="table-cell text-right">
                    <ActionDropdown
                      id={`form-${c.id}`}
                      items={getFormMenuItems(c)}
                      openMenuId={openMenuId}
                      setOpenMenuId={setOpenMenuId}
                    />
                  </td>
                </tr>
              ))}
              {forms.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">No forms yet</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
          {(forms as Campaign[]).map((c) => (
            <div key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-surface-900 dark:text-surface-100 truncate">{c.name}</span>
                    <span className={STATUS_COLORS[c.status] ?? 'badge'}>{c.status}</span>
                  </div>
                  <p className="text-xs text-surface-600 dark:text-surface-400">
                    {DEPLOYMENT_LABELS[c.deploymentType] ?? c.deploymentType} &middot; {new Date(c.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                  </p>
                </div>
                <ActionDropdown
                  id={`form-m-${c.id}`}
                  items={getFormMenuItems(c)}
                  openMenuId={openMenuId}
                  setOpenMenuId={setOpenMenuId}
                />
              </div>
            </div>
          ))}
          {forms.length === 0 && (
            <div className="p-8 text-center text-surface-700 dark:text-surface-300">No forms yet</div>
          )}
        </div>
      </div>

      {/* ── Edit Form Modal ───────────────────────── */}
      {editingForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-surface-900 rounded-xl shadow-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Edit Form</h3>
              <button onClick={() => setEditingForm(null)} className="text-surface-700 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <fetcher.Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="updateForm" />
              <input type="hidden" name="id" value={editingForm.id} />
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Form Name</label>
                <input name="name" type="text" defaultValue={editingForm.name} className="input w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">Status</label>
                <select name="status" defaultValue={editingForm.status} className="input w-full">
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </div>
              <div className="border-t border-surface-200 dark:border-surface-700 pt-3">
                <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-2">
                  Form Customization
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input name="formHeading" type="text" placeholder="Form heading" defaultValue={editingForm.formConfig?.heading ?? ''} className="input" />
                  <input name="formSubtitle" type="text" placeholder="Form subtitle" defaultValue={editingForm.formConfig?.subtitle ?? ''} className="input" />
                  <input name="formButtonText" type="text" placeholder="Button text" defaultValue={editingForm.formConfig?.buttonText ?? ''} className="input" />
                  <div className="flex items-center gap-2">
                    <input name="formAccentColor" type="color" defaultValue={editingForm.formConfig?.accentColor ?? '#6366f1'} className="w-10 h-9 rounded border border-surface-200 dark:border-surface-700 cursor-pointer" />
                    <span className="text-sm text-surface-800 dark:text-surface-200">Accent color</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="secondary" size="sm" onClick={() => setEditingForm(null)}>Cancel</Button>
                <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Saving...">
                  Save Changes
                </Button>
              </div>
            </fetcher.Form>
          </div>
        </div>
      )}

      {/* ── Deployment Modal ──────────────────────────── */}
      {deploymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-surface-900 rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-surface-900 dark:text-white">
                Deployment: {deploymentModal.name}
              </h3>
              <button onClick={() => setDeploymentModal(null)} className="text-surface-700 hover:text-surface-900">
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
                  <label className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Hosted URL</label>
                  <button
                    onClick={() => navigator.clipboard.writeText(`${edgeWorkerUrl}/form/${deploymentModal.id}`)}
                    className="text-xs text-brand-500 hover:text-brand-600 font-medium"
                  >
                    Copy
                  </button>
                </div>
                <div className="mt-1 p-3 bg-surface-50 dark:bg-surface-800 rounded-lg">
                  <code className="text-sm text-brand-600 dark:text-brand-400 break-all">
                    {edgeWorkerUrl}/form/{deploymentModal.id}
                  </code>
                </div>
                <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                  Share this URL directly with customers or use as a landing page.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">iFrame Embed</label>
                  <button
                    onClick={() => navigator.clipboard.writeText(`<iframe src="${edgeWorkerUrl}/form/${deploymentModal.id}" width="100%" height="500" frameBorder="0"></iframe>`)}
                    className="text-xs text-brand-500 hover:text-brand-600 font-medium"
                  >
                    Copy
                  </button>
                </div>
                <div className="mt-1 p-3 bg-surface-50 dark:bg-surface-800 rounded-lg">
                  <code className="text-xs text-surface-700 dark:text-surface-300 break-all">
                    {`<iframe src="${edgeWorkerUrl}/form/${deploymentModal.id}" width="100%" height="500" frameBorder="0"></iframe>`}
                  </code>
                </div>
                <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                  Embed the form as an iframe on any website or landing page.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Shadow DOM Snippet</label>
                  <button
                    onClick={() => navigator.clipboard.writeText(`<div id="yannis-form"></div><script src="${edgeWorkerUrl}/embed.js?campaign=${deploymentModal.id}"></script>`)}
                    className="text-xs text-brand-500 hover:text-brand-600 font-medium"
                  >
                    Copy
                  </button>
                </div>
                <div className="mt-1 p-3 bg-surface-50 dark:bg-surface-800 rounded-lg">
                  <code className="text-xs text-surface-700 dark:text-surface-300 break-all">
                    {`<div id="yannis-form"></div><script src="${edgeWorkerUrl}/embed.js?campaign=${deploymentModal.id}"></script>`}
                  </code>
                </div>
                <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                  Inject the form into any page via Shadow DOM — isolated from parent styles.
                </p>
              </div>
            </div>

            <Button variant="secondary" size="sm" className="w-full" onClick={() => setDeploymentModal(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
