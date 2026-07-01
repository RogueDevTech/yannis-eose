import { json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { useState, useCallback } from 'react';
import { getCurrentUser, apiRequest, getSessionCookie } from '~/lib/api.server';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { Modal } from '~/components/ui/modal';
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

  if (options) {
    return (
      <FormSelect
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={options}
      />
    );
  }

  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-app-fg-muted">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 md:h-9 w-full text-sm rounded-md border border-app-border bg-app-elevated px-3 text-app-fg focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
      />
    </div>
  );
}

// ── Tree rendering ──────────────────────────────────────────────────

/**
 * Renders the full page list — groups are subtle section headers,
 * pages are tappable cards underneath.
 */
function FilterPrefsList({
  tree,
  allPrefs,
  onSave,
  onReset,
}: {
  tree: PageTreeNode[];
  allPrefs: Record<string, Record<string, string>>;
  onSave: (pageKey: string, filters: Record<string, string>) => void;
  onReset: (pageKey: string) => void;
}) {
  return (
    <div className="space-y-6">
      {tree.map((group) => {
        const isGroup = group.children.length > 0;
        if (!isGroup) {
          // Top-level leaf page (Products, Returns, etc.)
          return (
            <FilterPrefsNode key={group.key} node={group} allPrefs={allPrefs} onSave={onSave} onReset={onReset} depth={0} />
          );
        }
        return (
          <div key={group.key}>
            <h3 className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider mb-2 px-1">
              {group.label}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {group.children.map((child) => (
                <FilterPrefsNode key={child.key} node={child} allPrefs={allPrefs} onSave={onSave} onReset={onReset} depth={1} />
              ))}
            </div>
          </div>
        );
      })}
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
  const userPrefs = allPrefs[node.key];
  const hasUserPrefs = userPrefs && Object.keys(userPrefs).length > 0;
  const hasDefaults = node.defaultFilters && Object.keys(node.defaultFilters).length > 0;

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

  // Leaf page: tappable card → opens modal
  const filterCount = Object.keys(editValues).length;
  const visibleFilters = Object.entries(editValues)
    .sort(([a], [b]) => {
      const order = ['datePreset', 'startDate', 'endDate', 'period', 'status', 'perPage', 'sortBy', 'sortOrder', 'sortDir'];
      return (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b));
    })
    .filter(([k]) => {
      if (k === 'period' && 'datePreset' in editValues) return false;
      if ((k === 'startDate' || k === 'endDate') && 'datePreset' in editValues) return false;
      if ((k === 'startDate' || k === 'endDate') && editValues.period === 'all_time') return false;
      return true;
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full h-full rounded-lg border border-app-border bg-app-elevated p-3 text-left hover:border-brand-300 dark:hover:border-brand-700 transition-colors flex flex-col"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-app-fg">{node.label}</span>
          {hasUserPrefs ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 dark:bg-brand-900/30 px-2 py-0.5 text-micro font-medium text-brand-600 dark:text-brand-400">
              Customized
            </span>
          ) : hasDefaults ? (
            <span className="inline-flex items-center rounded-full bg-app-bg-hover px-2 py-0.5 text-micro text-app-fg-muted">
              Default
            </span>
          ) : null}
        </div>
        {filterCount > 0 && (
          <div className="mt-2 space-y-0.5">
            {visibleFilters.slice(0, 2).map(([k, v]) => {
              const options = getOptions(k);
              const displayVal = options?.find((o) => o.value === v)?.label ?? v;
              return (
                <p key={k} className="text-micro text-app-fg-muted truncate">
                  {FILTER_LABELS[k] ?? k}: <span className="text-app-fg">{displayVal}</span>
                </p>
              );
            })}
            {visibleFilters.length > 2 && (
              <p className="text-micro text-app-fg-muted">+{visibleFilters.length - 2} more</p>
            )}
          </div>
        )}
        <div className="flex items-center gap-1 mt-auto pt-2 text-micro text-brand-500 dark:text-brand-400 font-medium">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
          </svg>
          Edit filters
        </div>
      </button>

      <Modal open={expanded} onClose={() => setExpanded(false)} maxWidth="max-w-md" contentClassName="p-5 md:p-6">
        <div className="space-y-5">
          <div>
            <h3 className="text-base font-semibold text-app-fg">{node.label}</h3>
            <p className="text-sm text-app-fg-muted mt-1">Set default filters for this page.</p>
          </div>

          {filterCount > 0 ? (
            <div className="space-y-4">
              {visibleFilters.map(([k, v]) => (
                <FilterEditor
                  key={k}
                  filterKey={k}
                  value={v}
                  onChange={(newVal) => handleChange(k, newVal)}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-app-fg-muted py-6 text-center">
              No configurable filters for this page.
            </p>
          )}

          <div className="flex items-center gap-3 pt-4 border-t border-app-border">
            <Button size="sm" variant="primary" onClick={() => { handleSave(); setExpanded(false); }} disabled={!dirty}>
              {dirty ? 'Save changes' : 'Saved'}
            </Button>
            {hasUserPrefs && (
              <Button size="sm" variant="ghost" onClick={() => { handleReset(); setExpanded(false); }}>
                Reset to default
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setExpanded(false)} className="ml-auto">
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
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
        <FilterPrefsList tree={tree} allPrefs={allPrefs} onSave={handleSave} onReset={handleReset} />
      )}
    </div>
  );
}
