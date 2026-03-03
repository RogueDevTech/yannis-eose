import { useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Tabs } from '~/components/ui/tabs';
import type { Campaign, OfferTemplate, Product, CampaignsPageProps } from './types';

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

export function CampaignsPage({
  templates,
  totalTemplates,
  campaigns,
  totalCampaigns,
  products,
}: CampaignsPageProps) {
  const fetcher = useFetcher();
  const [activeTab, setActiveTab] = useState<'campaigns' | 'templates'>('campaigns');
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [showAddCampaign, setShowAddCampaign] = useState(false);
  const [deploymentModal, setDeploymentModal] = useState<Campaign | null>(null);

  const actionError = (fetcher.data as { error?: string })?.error;
  const actionSuccess = (fetcher.data as { success?: boolean })?.success;
  useFetcherToast(fetcher.data, { successMessage: 'Campaign saved' });

  if (actionSuccess && showAddTemplate) setShowAddTemplate(false);
  if (actionSuccess && showAddCampaign) setShowAddCampaign(false);

  const edgeWorkerUrl = (typeof window !== 'undefined' && (window as { __ENV?: { EDGE_WORKER_URL?: string } }).__ENV?.EDGE_WORKER_URL)
    || 'https://yannis-edge-worker.your-domain.workers.dev';

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Campaigns</h1>
          <p className="text-sm text-surface-800 dark:text-surface-400 mt-0.5">
            Offer templates, campaign management, and form deployment
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAddTemplate(!showAddTemplate)} className="btn-secondary btn-sm">
            + Template
          </button>
          <button onClick={() => setShowAddCampaign(!showAddCampaign)} className="btn-primary btn-sm">
            + Campaign
          </button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-700 dark:text-danger-500">{actionError}</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Templates</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{totalTemplates}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Campaigns</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{totalCampaigns}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Active Campaigns</p>
          <p className="text-2xl font-bold text-success-600 dark:text-success-400 mt-1">
            {(campaigns as Campaign[]).filter((c) => c.status === 'ACTIVE').length}
          </p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Products</p>
          <DeferredSection resolve={products} skeleton="inline">
            {(resolvedProducts) => (
              <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{resolvedProducts.length}</p>
            )}
          </DeferredSection>
        </div>
      </div>

      {/* Add Template Form */}
      {showAddTemplate && (
        <fetcher.Form method="post" className="card space-y-3">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">New Offer Template</h3>
          <input type="hidden" name="intent" value="createTemplate" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
            <input name="name" type="text" required placeholder="Template name" className="input" />
            <input name="price" type="text" required placeholder="Offer price (e.g. 15000)" pattern="\d+(\.\d{1,2})?" className="input" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary btn-sm" disabled={fetcher.state === 'submitting'}>
              {fetcher.state === 'submitting' ? 'Creating...' : 'Create Template'}
            </button>
            <button type="button" onClick={() => setShowAddTemplate(false)} className="btn-secondary btn-sm">Cancel</button>
          </div>
        </fetcher.Form>
      )}

      {/* Add Campaign Form */}
      {showAddCampaign && (
        <fetcher.Form method="post" className="card space-y-3">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">New Campaign</h3>
          <input type="hidden" name="intent" value="createCampaign" />

          {/* Core campaign fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input name="name" type="text" required placeholder="Campaign name" className="input" />
            <select name="offerTemplateId" required className="input">
              <option value="">Select offer template...</option>
              {(templates as OfferTemplate[]).filter((t) => t.status === 'ACTIVE').map((t) => (
                <option key={t.id} value={t.id}>{t.name} (&#8358;{Number(t.price).toLocaleString()})</option>
              ))}
            </select>
            <DeferredSection resolve={products} skeleton="inline">
              {(resolvedProducts) => (
                <select name="productId" required className="input">
                  <option value="">Select product...</option>
                  {resolvedProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
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

          {/* Form customization */}
          <div className="border-t border-surface-200 dark:border-surface-700 pt-3">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider mb-2">
              Form Customization (Optional)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input name="formHeading" type="text" placeholder="Form heading (default: Place Your Order)" className="input" />
              <input name="formSubtitle" type="text" placeholder="Form subtitle" className="input" />
              <input name="formButtonText" type="text" placeholder="Button text (default: Submit Order)" className="input" />
              <div className="flex items-center gap-2">
                <input name="formAccentColor" type="color" defaultValue="#6366f1" className="w-10 h-9 rounded border border-surface-200 dark:border-surface-700 cursor-pointer" />
                <span className="text-sm text-surface-800 dark:text-surface-400">Accent color</span>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button type="submit" className="btn-primary btn-sm" disabled={fetcher.state === 'submitting'}>
              {fetcher.state === 'submitting' ? 'Creating...' : 'Create Campaign'}
            </button>
            <button type="button" onClick={() => setShowAddCampaign(false)} className="btn-secondary btn-sm">Cancel</button>
          </div>
        </fetcher.Form>
      )}

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as typeof activeTab)}
        tabs={[
          { value: 'campaigns', label: `Campaigns (${totalCampaigns})` },
          { value: 'templates', label: `Offer Templates (${totalTemplates})` },
        ]}
      />

      {/* Campaigns Table */}
      {activeTab === 'campaigns' && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Campaign</th>
                <th className="table-header">Type</th>
                <th className="table-header">Status</th>
                <th className="table-header">Created</th>
                <th className="table-header">Deploy</th>
              </tr>
            </thead>
            <tbody>
              {(campaigns as Campaign[]).map((c) => (
                <tr key={c.id} className="table-row">
                  <td className="table-cell font-medium text-surface-900 dark:text-surface-100">{c.name}</td>
                  <td className="table-cell text-surface-800 dark:text-surface-400">
                    {DEPLOYMENT_LABELS[c.deploymentType] ?? c.deploymentType}
                  </td>
                  <td className="table-cell">
                    <span className={STATUS_COLORS[c.status] ?? 'badge'}>{c.status}</span>
                  </td>
                  <td className="table-cell text-surface-800 dark:text-surface-400">
                    {new Date(c.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                  </td>
                  <td className="table-cell">
                    <button
                      onClick={() => setDeploymentModal(c)}
                      className="text-brand-500 hover:text-brand-600 text-sm font-medium"
                    >
                      View Links
                    </button>
                  </td>
                </tr>
              ))}
              {campaigns.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-surface-700 dark:text-surface-500">No campaigns yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Templates Table */}
      {activeTab === 'templates' && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Template</th>
                <th className="table-header text-right">Price</th>
                <th className="table-header">Product</th>
                <th className="table-header">Status</th>
                <th className="table-header">Created</th>
              </tr>
            </thead>
            <tbody>
              {(templates as OfferTemplate[]).map((t) => (
                <tr key={t.id} className="table-row">
                  <td className="table-cell font-medium text-surface-900 dark:text-surface-100">{t.name}</td>
                  <td className="table-cell text-right font-medium">&#8358;{Number(t.price).toLocaleString()}</td>
                  <td className="table-cell text-surface-800 dark:text-surface-400">
                    <DeferredSection resolve={products} skeleton="inline">
                      {(resolvedProducts) => {
                        const product = resolvedProducts.find((p) => p.id === t.productId);
                        return <>{product?.name ?? t.productId.slice(0, 8)}</>;
                      }}
                    </DeferredSection>
                  </td>
                  <td className="table-cell">
                    <span className={STATUS_COLORS[t.status] ?? 'badge'}>{t.status}</span>
                  </td>
                  <td className="table-cell text-surface-800 dark:text-surface-400">
                    {new Date(t.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                  </td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-surface-700 dark:text-surface-500">No templates yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Deployment Modal */}
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
              {/* Hosted URL */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Hosted URL</label>
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
                <p className="text-xs text-surface-700 dark:text-surface-500 mt-1">
                  Share this URL directly with customers or use as a landing page.
                </p>
              </div>

              {/* iFrame Embed */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">iFrame Embed</label>
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
                <p className="text-xs text-surface-700 dark:text-surface-500 mt-1">
                  Embed the form as an iframe on any website or landing page.
                </p>
              </div>

              {/* Shadow DOM Snippet */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Shadow DOM Snippet</label>
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
                <p className="text-xs text-surface-700 dark:text-surface-500 mt-1">
                  Inject the form into any page via Shadow DOM — isolated from parent styles.
                </p>
              </div>
            </div>

            <button onClick={() => setDeploymentModal(null)} className="btn-secondary btn-sm w-full">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
