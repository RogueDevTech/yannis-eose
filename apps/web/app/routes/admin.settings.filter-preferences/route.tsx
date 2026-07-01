import { json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { useState } from 'react';
import { getCurrentUser, apiRequest, getSessionCookie } from '~/lib/api.server';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { EmptyState } from '~/components/ui/empty-state';
import { SaveFilterPrefsButton } from '~/components/ui/save-filter-prefs-button';
import {
  PAGE_REGISTRY,
  buildPageTree,
  filterPageTreeByPermissions,
  type PageTreeNode,
} from '@yannis/shared/page-registry';

export const meta: MetaFunction = () => [
  { title: 'Filter Preferences — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const prefsRes = await apiRequest<unknown>(
    '/trpc/filterPreferences.getAll',
    { method: 'GET', cookie },
  ).catch(() => ({ ok: false as const, data: null }));

  const allPrefs: Record<string, Record<string, string>> =
    prefsRes.ok
      ? ((prefsRes.data as { result?: { data?: Record<string, Record<string, string>> } })?.result?.data ?? {})
      : {};

  const tree = filterPageTreeByPermissions(
    buildPageTree(PAGE_REGISTRY),
    user.permissions ?? [],
    user.role,
  );

  return json({ allPrefs, tree, userRole: user.role });
}

const FILTER_LABELS: Record<string, string> = {
  startDate: 'Start Date',
  endDate: 'End Date',
  period: 'Period',
  status: 'Status',
  mediaBuyerId: 'Media Buyer',
  csCloserId: 'CS Closer',
  productId: 'Product',
  campaignId: 'Campaign',
  fromLocationId: 'From Location',
  toLocationId: 'To Location',
  locationId: 'Location',
  branchId: 'Branch',
  perPage: 'Per Page',
  fromCart: 'From Cart',
  testOrders: 'Test Orders',
  sortBy: 'Sort By',
  sortOrder: 'Sort Order',
  sortDir: 'Sort Direction',
};

function FilterPrefsTree({
  nodes,
  allPrefs,
  depth = 0,
}: {
  nodes: PageTreeNode[];
  allPrefs: Record<string, Record<string, string>>;
  depth?: number;
}) {
  return (
    <div className={depth > 0 ? 'ml-4 border-l border-app-border pl-3' : ''}>
      {nodes.map((node) => (
        <FilterPrefsNode key={node.key} node={node} allPrefs={allPrefs} depth={depth} />
      ))}
    </div>
  );
}

function FilterPrefsNode({
  node,
  allPrefs,
  depth,
}: {
  node: PageTreeNode;
  allPrefs: Record<string, Record<string, string>>;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isGroup = node.children.length > 0;
  const prefs = allPrefs[node.key];
  const hasPrefs = prefs && Object.keys(prefs).length > 0;
  const isLeaf = !isGroup;

  // Count how many children/descendants have saved prefs
  const savedCount = isGroup ? countSavedPrefs(node, allPrefs) : 0;

  return (
    <div className="py-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 py-1.5 px-2 rounded-md text-left hover:bg-app-bg-hover transition-colors"
      >
        {isGroup && (
          <svg
            className={`h-3.5 w-3.5 shrink-0 text-app-fg-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        )}
        {!isGroup && <span className="w-3.5" />}

        <span className={`text-sm ${isGroup ? 'font-semibold text-app-fg' : 'text-app-fg'}`}>
          {node.label}
        </span>

        {isGroup && savedCount > 0 && (
          <span className="ml-auto text-micro text-brand-500 dark:text-brand-400 tabular-nums">
            {savedCount} saved
          </span>
        )}
        {isLeaf && hasPrefs && (
          <span className="ml-auto text-micro text-brand-500 dark:text-brand-400">
            Defaults saved
          </span>
        )}
      </button>

      {expanded && isGroup && (
        <FilterPrefsTree nodes={node.children} allPrefs={allPrefs} depth={depth + 1} />
      )}

      {expanded && isLeaf && (
        <div className="ml-9 mt-1 mb-2 p-3 rounded-md bg-app-bg-hover">
          {hasPrefs ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(prefs).map(([k, v]) => (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-900/20 px-2 py-0.5 text-micro text-brand-700 dark:text-brand-300"
                  >
                    <span className="font-medium">{FILTER_LABELS[k] ?? k}:</span>
                    <span className="max-w-[10rem] truncate">{v}</span>
                  </span>
                ))}
              </div>
              <SaveFilterPrefsButton pageKey={node.key} className="mt-1" />
            </div>
          ) : (
            <p className="text-micro text-app-fg-muted">
              No defaults saved. Visit the page, set your preferred filters, then use the bookmark icon to save.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function countSavedPrefs(node: PageTreeNode, allPrefs: Record<string, Record<string, string>>): number {
  let count = 0;
  const nodePrefs = allPrefs[node.key];
  if (nodePrefs && Object.keys(nodePrefs).length > 0) count++;
  for (const child of node.children) {
    count += countSavedPrefs(child, allPrefs);
  }
  return count;
}

export default function FilterPreferencesPage() {
  const { allPrefs, tree } = useLoaderData<typeof loader>();

  const totalSaved = Object.values(allPrefs).filter((v) => Object.keys(v).length > 0).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Filter Preferences"
        mobileInlineActions
        description="Set default filters for each page. Saved defaults apply when you visit a page without specific filters."
      />

      {totalSaved > 0 && (
        <p className="text-sm text-app-fg-muted">
          You have saved defaults on <strong>{totalSaved}</strong> page{totalSaved !== 1 ? 's' : ''}.
        </p>
      )}

      {tree.length === 0 ? (
        <EmptyState title="No pages available" description="You don't have access to any filterable pages." />
      ) : (
        <div className="card divide-y divide-app-border">
          {tree.map((group) => (
            <FilterPrefsTree key={group.key} nodes={[group]} allPrefs={allPrefs} />
          ))}
        </div>
      )}
    </div>
  );
}
