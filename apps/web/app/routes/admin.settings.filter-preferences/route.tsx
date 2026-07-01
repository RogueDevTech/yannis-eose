import { json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { useState, useCallback } from 'react';
import { getCurrentUser, apiRequest, getSessionCookie } from '~/lib/api.server';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { EmptyState } from '~/components/ui/empty-state';
import { useToast } from '~/components/ui/toast';
import {
  PAGE_REGISTRY,
  FILTER_LABELS,
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

  return json({ allPrefs, tree });
}

// ── Preset options for select dropdowns ─────────────────────────────

const DATE_PRESET_OPTIONS = [
  { value: 'Today', label: 'Today' },
  { value: 'This Week', label: 'This Week' },
  { value: 'This Month', label: 'This Month' },
  { value: 'Last 7 Days', label: 'Last 7 Days' },
  { value: 'Last 30 Days', label: 'Last 30 Days' },
  { value: 'All Time', label: 'All Time' },
];

const PER_PAGE_OPTIONS = ['20', '50', '100', '200', '400', '500'];

const SORT_ORDER_OPTIONS = [
  { value: 'desc', label: 'Newest first' },
  { value: 'asc', label: 'Oldest first' },
];

const SORT_DIR_OPTIONS = [
  { value: 'asc', label: 'A → Z' },
  { value: 'desc', label: 'Z → A' },
];

const SORT_BY_OPTIONS = [
  { value: 'createdAt', label: 'Created date' },
  { value: 'name', label: 'Name' },
  { value: 'preferredDeliveryDate', label: 'Delivery date' },
];

// ── Shared select class ─────────────────────────────────────────────

const selectCls = 'h-10 md:h-9 w-full text-sm rounded-md border border-app-border bg-app-elevated px-3 text-app-fg focus:border-brand-500 focus:ring-1 focus:ring-brand-500 appearance-none';
const inputCls = 'h-10 md:h-9 w-full text-sm rounded-md border border-app-border bg-app-elevated px-3 text-app-fg focus:border-brand-500 focus:ring-1 focus:ring-brand-500';

// ── Options lookup by key ───────────────────────────────────────────

function getOptions(filterKey: string): { value: string; label: string }[] | null {
  switch (filterKey) {
    case 'datePreset': return DATE_PRESET_OPTIONS;
    case 'perPage': return PER_PAGE_OPTIONS.map((v) => ({ value: v, label: `${v} rows` }));
    case 'sortOrder': return SORT_ORDER_OPTIONS;
    case 'sortDir': return SORT_DIR_OPTIONS;
    case 'sortBy': return SORT_BY_OPTIONS;
    default: return null;
  }
}

// ── Inline editor for a single filter ───────────────────────────────

function FilterEditor({
  filterKey,
  value,
  onChange,
}: {
  filterKey: string;
  value: string;
  onChange: (newValue: string) => void;
}) {
  const label = FILTER_LABELS[filterKey] ?? filterKey;
  const options = getOptions(filterKey);

  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-app-fg-muted">{label}</label>
      {options ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      )}
    </div>
  );
}

// ── Tree rendering ──────────────────────────────────────────────────

function FilterPrefsTree({
  nodes,
  allPrefs,
  onSave,
  onReset,
  depth = 0,
}: {
  nodes: PageTreeNode[];
  allPrefs: Record<string, Record<string, string>>;
  onSave: (pageKey: string, filters: Record<string, string>) => void;
  onReset: (pageKey: string) => void;
  depth?: number;
}) {
  return (
    <div className={depth > 0 ? 'pl-6' : ''}>
      {nodes.map((node) => (
        <FilterPrefsNode key={node.key} node={node} allPrefs={allPrefs} onSave={onSave} onReset={onReset} depth={depth} />
      ))}
    </div>
  );
}

function FilterPrefsNode({
  node,
  allPrefs,
  onSave,
  onReset,
  depth,
}: {
  node: PageTreeNode;
  allPrefs: Record<string, Record<string, string>>;
  onSave: (pageKey: string, filters: Record<string, string>) => void;
  onReset: (pageKey: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isGroup = node.children.length > 0;
  const userPrefs = allPrefs[node.key];
  const hasUserPrefs = userPrefs && Object.keys(userPrefs).length > 0;
  const hasDefaults = node.defaultFilters && Object.keys(node.defaultFilters).length > 0;
  const isLeaf = !isGroup;

  // Local editing state — starts from user prefs or system defaults.
  // When user prefs have explicit date params, drop the registry's datePreset
  // so the UI shows the actual saved values instead of the stale preset label.
  const [editValues, setEditValues] = useState<Record<string, string>>(() => {
    const merged = { ...(node.defaultFilters ?? {}), ...(userPrefs ?? {}) };
    if (userPrefs && (userPrefs.startDate || userPrefs.endDate || userPrefs.period)) {
      delete merged.datePreset;
    }
    if (userPrefs && userPrefs.period === 'all_time') {
      delete merged.startDate;
      delete merged.endDate;
      merged.period = 'all_time';
    }
    return merged;
  });
  const [dirty, setDirty] = useState(false);

  const overrideCount = isGroup ? countOverrides(node, allPrefs) : 0;

  const handleChange = (key: string, value: string) => {
    setEditValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = () => {
    onSave(node.key, editValues);
    setDirty(false);
  };

  const handleReset = () => {
    setEditValues({ ...(node.defaultFilters ?? {}) });
    onReset(node.key);
    setDirty(false);
  };

  return (
    <div className="py-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`w-full flex items-center gap-2 py-2.5 px-3 rounded-lg text-left transition-colors ${
          expanded && isLeaf
            ? 'bg-brand-50/50 dark:bg-brand-900/10'
            : 'hover:bg-app-bg-hover'
        }`}
      >
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-app-fg-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>

        <span className={`text-sm flex-1 ${isGroup ? 'font-semibold text-app-fg' : 'text-app-fg'}`}>
          {node.label}
        </span>

        {isGroup && overrideCount > 0 && (
          <span className="text-micro text-brand-500 dark:text-brand-400 tabular-nums">
            {overrideCount} customized
          </span>
        )}
        {isLeaf && hasUserPrefs && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 dark:bg-brand-900/30 px-2 py-0.5 text-micro font-medium text-brand-600 dark:text-brand-400">
            Customized
          </span>
        )}
        {isLeaf && !hasUserPrefs && hasDefaults && (
          <span className="inline-flex items-center gap-1 rounded-full bg-app-bg-hover px-2 py-0.5 text-micro text-app-fg-muted">
            Default
          </span>
        )}
      </button>

      {expanded && isGroup && (
        <FilterPrefsTree nodes={node.children} allPrefs={allPrefs} onSave={onSave} onReset={onReset} depth={depth + 1} />
      )}

      {expanded && isLeaf && (
        <div className="mt-1 mb-2 rounded-lg border border-app-border bg-app-elevated overflow-hidden">
          {Object.keys(editValues).length > 0 ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-3 md:p-4">
                {Object.entries(editValues)
                  .sort(([a], [b]) => {
                    const order = ['datePreset', 'startDate', 'endDate', 'period', 'status', 'perPage', 'sortBy', 'sortOrder', 'sortDir'];
                    const ai = order.indexOf(a);
                    const bi = order.indexOf(b);
                    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                  })
                  .filter(([k]) => {
                    // Hide period when datePreset is present (All Time is a datePreset option)
                    if (k === 'period' && 'datePreset' in editValues) return false;
                    // Hide raw startDate/endDate when datePreset drives the range
                    if ((k === 'startDate' || k === 'endDate') && 'datePreset' in editValues) return false;
                    // Hide raw startDate/endDate when period=all_time (no dates)
                    if ((k === 'startDate' || k === 'endDate') && editValues.period === 'all_time') return false;
                    return true;
                  })
                  .map(([k, v]) => (
                  <FilterEditor
                    key={k}
                    filterKey={k}
                    value={v}
                    onChange={(newVal) => handleChange(k, newVal)}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2 px-3 md:px-4 py-2.5 bg-app-bg-hover border-t border-app-border">
                <Button size="sm" variant="primary" onClick={handleSave} disabled={!dirty}>
                  {dirty ? 'Save changes' : 'Saved'}
                </Button>
                {hasUserPrefs && (
                  <Button size="sm" variant="ghost" onClick={handleReset}>
                    Reset to default
                  </Button>
                )}
                {dirty && (
                  <span className="text-xs text-warning-600 dark:text-warning-400 ml-auto">Unsaved</span>
                )}
              </div>
            </>
          ) : (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-app-fg-muted">
                No configurable filters for this page.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function countOverrides(node: PageTreeNode, allPrefs: Record<string, Record<string, string>>): number {
  let count = 0;
  const nodePrefs = allPrefs[node.key];
  if (nodePrefs && Object.keys(nodePrefs).length > 0) count++;
  for (const child of node.children) {
    count += countOverrides(child, allPrefs);
  }
  return count;
}

// ── Page component ──────────────────────────────────────────────────

export default function FilterPreferencesPage() {
  const { allPrefs: initialPrefs, tree } = useLoaderData<typeof loader>();
  const [allPrefs, setAllPrefs] = useState(initialPrefs);
  const { toast } = useToast();

  const totalOverrides = Object.values(allPrefs).filter((v) => Object.keys(v).length > 0).length;

  const handleSave = useCallback((pageKey: string, rawFilters: Record<string, string>) => {
    // Normalize: datePreset "All Time" → period=all_time, drop startDate/endDate
    const filters = { ...rawFilters };
    if (filters.datePreset === 'All Time') {
      filters.period = 'all_time';
      delete filters.startDate;
      delete filters.endDate;
    }
    if (filters.period === 'all_time') {
      delete filters.startDate;
      delete filters.endDate;
    }
    fetch('/api/filter-preferences', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'upsert', pageKey, filters }),
    })
      .then(() => {
        setAllPrefs((prev) => ({ ...prev, [pageKey]: filters }));
        toast.success('Filter defaults saved');
      })
      .catch(() => toast.error('Failed to save'));
  }, [toast]);

  const handleReset = useCallback((pageKey: string) => {
    fetch('/api/filter-preferences', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'delete', pageKey }),
    })
      .then(() => {
        setAllPrefs((prev) => {
          const next = { ...prev };
          delete next[pageKey];
          return next;
        });
        toast.info('Reset to system default');
      })
      .catch(() => toast.error('Failed to reset'));
  }, [toast]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Filter Preferences"
        mobileInlineActions
        description="Set default filters for each page. Changes apply on your next visit."
      />

      {totalOverrides > 0 && (
        <p className="text-sm text-app-fg-muted">
          You have customized defaults on <strong>{totalOverrides}</strong> page{totalOverrides !== 1 ? 's' : ''}.
        </p>
      )}

      {tree.length === 0 ? (
        <EmptyState title="No pages available" description="You don't have access to any filterable pages." />
      ) : (
        <div className="card divide-y divide-app-border">
          {tree.map((group) => (
            <FilterPrefsTree key={group.key} nodes={[group]} allPrefs={allPrefs} onSave={handleSave} onReset={handleReset} />
          ))}
        </div>
      )}
    </div>
  );
}
