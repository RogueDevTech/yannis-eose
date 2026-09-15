import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { SearchInput } from '~/components/ui/search-input';
import { symbolForCurrencyCode } from '@yannis/shared';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';
import { searchRoutes, personContextRoutes, type RouteSearchGroup } from '~/lib/route-search';
import {
  loadRecentSearchEntries,
  pushRecentSearchEntry,
  type RecentSearchEntry,
} from '~/lib/recent-searches';

/**
 * Command palette (Cmd+K) — one ranked list over PAGES and RECORDS.
 *
 * It used to search records only, so typing a page name found nothing and the
 * user fell back to hunting through the sidebar. Now:
 *
 *  - pages rank instantly and locally (typo-, acronym- and synonym-tolerant,
 *    see `~/lib/smart-search`), so "remitance", "cr" and "salary" all land;
 *  - records still come from the server, debounced;
 *  - a matched PERSON also produces the pages where that person is the
 *    subject — their profile, attendance, their orders — with the id already
 *    in the URL. That is what makes typing a staff name useful: "Olasukanmi"
 *    matches no page label, but the person is reachable from several.
 *
 * Permission safety: page results come from the caller's own already-filtered
 * nav tree, and a person-context page is only offered when its nav entry is in
 * that tree. Nothing here can surface a page the caller cannot open.
 */

interface OrderHit {
  id: string;
  customerName?: string | null;
  status?: string | null;
  totalAmount?: string | null;
  /** Per-record currency. Absent on older rows, where NGN is the correct default. */
  currencyCode?: string | null;
}

interface SearchResult {
  /** Unique within a render — used as the React key and for recents. */
  key: string;
  kind: 'page' | 'person-page' | 'order' | 'product' | 'user';
  title: string;
  subtitle: string;
  href: string;
}

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * The caller's permission-filtered nav tree. Pages are matched against this,
   * so the palette can never offer a page the sidebar would not show.
   */
  navGroups?: Array<RouteSearchGroup<{ label: string; href: string; tabs?: Array<{ value: string; label: string }>; keywords?: string[] }>>;
}

const KIND_LABELS: Record<SearchResult['kind'], { label: string; color: string }> = {
  page: { label: 'Page', color: 'bg-app-hover text-app-fg-muted' },
  'person-page': { label: 'Go to', color: 'bg-warning-100 text-warning-700 dark:bg-warning-700/20 dark:text-warning-400' },
  order: { label: 'Order', color: 'bg-brand-100 text-brand-700 dark:bg-brand-700/20 dark:text-brand-400' },
  product: { label: 'Product', color: 'bg-success-100 text-success-700 dark:bg-success-700/20 dark:text-success-400' },
  user: { label: 'User', color: 'bg-info-100 text-info-700 dark:bg-info-700/20 dark:text-info-400' },
};

/** Pages are capped so records are never pushed off the visible list. */
const MAX_PAGE_RESULTS = 6;
const MAX_PERSON_PAGES = 4;

function titleCaseRole(role?: string | null): string {
  if (!role) return '';
  return role
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

function orderSubtitle(o: OrderHit, prefix?: string): string {
  const status = o.status?.replace(/_/g, ' ') ?? '';
  // Currency is a per-record attribute, so a hardcoded ₦ mislabels a non-NGN
  // order's total. `symbolForCurrencyCode` defaults to ₦ when the code is
  // absent, which is right for rows predating multi-currency.
  const amount = o.totalAmount
    ? `· ${symbolForCurrencyCode(o.currencyCode)}${parseFloat(o.totalAmount).toLocaleString()}`
    : '';
  return [prefix, status, amount].filter(Boolean).join(' · ').replace('· ·', '·');
}

export function SearchModal({ isOpen, onClose, navGroups = [] }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [entityResults, setEntityResults] = useState<SearchResult[]>([]);
  const [personPages, setPersonPages] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recents, setRecents] = useState<RecentSearchEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = query.trim();

  /** Every nav href the caller can reach — the permission gate for person pages. */
  const navHrefs = useMemo(
    () => new Set(navGroups.flatMap((g) => g.items.map((i) => i.href))),
    [navGroups],
  );

  // Pages match locally on every keystroke — no debounce, no request. A
  // one-character query is allowed here (unlike the server search, which needs
  // two) because "f" narrowing the page list is instant and cheap.
  const pageResults = useMemo<SearchResult[]>(() => {
    if (!trimmed) return [];
    return searchRoutes(navGroups, trimmed, { limit: MAX_PAGE_RESULTS }).map((hit) => ({
      key: `page:${hit.item.href}`,
      kind: 'page' as const,
      title: hit.tabLabel ? `${hit.item.label} › ${hit.tabLabel}` : hit.item.label,
      subtitle: hit.group ?? 'Navigation',
      href: hit.item.href,
    }));
  }, [navGroups, trimmed]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setEntityResults([]);
      setPersonPages([]);
      setSelectedIndex(0);
      setLoading(false);
      setRecents(loadRecentSearchEntries());
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      // Closing mid-flight would otherwise leave the spinner showing on reopen,
      // and let a landed response repopulate a palette the user has dismissed.
      abortRef.current?.abort();
      setLoading(false);
    }
  }, [isOpen]);

  // Drop any in-flight request when the palette unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  // `navGroups` is recreated on every parent render, so `navHrefs` changes
  // identity constantly. Reading it through a ref inside the fetch keeps it out
  // of the debounce effect's deps — otherwise any unrelated layout re-render
  // (socket reconnect, revalidation) clears the 250ms timer and restarts it,
  // which at a fast enough render cadence means the record search never fires.
  const navHrefsRef = useRef(navHrefs);
  useEffect(() => {
    navHrefsRef.current = navHrefs;
  }, [navHrefs]);

  const performSearch = useCallback(
    async (q: string) => {
      const hrefs = navHrefsRef.current;
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const apiUrl = getBrowserApiBaseUrl();
        const searchParam = encodeURIComponent(JSON.stringify({ search: q }));
        const res = await fetch(`${apiUrl}/trpc/orders.globalSearch?input=${searchParam}`, {
          credentials: 'include',
          signal: controller.signal,
        }).then((r) => r.json());

        if (controller.signal.aborted) return;

        const data = res?.result?.data;
        if (!data) {
          setEntityResults([]);
          setPersonPages([]);
          return;
        }

        const combined: SearchResult[] = [];
        const seenOrderIds = new Set<string>();

        const pushOrders = (rows: unknown, prefix: string | undefined, fromParam?: string) => {
          if (!Array.isArray(rows)) return;
          for (const o of (rows as OrderHit[]).slice(0, 5)) {
            if (seenOrderIds.has(o.id)) continue;
            seenOrderIds.add(o.id);
            combined.push({
              key: `order:${o.id}`,
              kind: 'order',
              title: o.customerName || 'Unnamed Order',
              subtitle: orderSubtitle(o, prefix),
              href: `/admin/orders/${o.id}${fromParam ? `?from=${fromParam}` : ''}`,
            });
          }
        };

        pushOrders(data.orders, undefined);
        pushOrders(data.followUpOrders, 'Follow-up', 'followup');
        pushOrders(data.cartOrders, 'Cart', 'cart-orders');

        if (Array.isArray(data.products)) {
          for (const p of data.products.slice(0, 3)) {
            const offers = (p.offers as Array<{ label: string }> | undefined)?.length ?? 0;
            combined.push({
              key: `product:${p.id}`,
              kind: 'product',
              title: p.name || 'Unnamed Product',
              subtitle: `${offers} offers · ${symbolForCurrencyCode(p.currencyCode)}${parseFloat(p.baseSalePrice ?? '0').toLocaleString()}`,
              // Was the bare list page, which made the user search again.
              href: `/admin/products/${p.id}`,
            });
          }
        }

        const nextPersonPages: SearchResult[] = [];
        if (Array.isArray(data.users)) {
          for (const u of data.users.slice(0, 3)) {
            combined.push({
              key: `user:${u.id}`,
              kind: 'user',
              title: u.name || 'Unnamed User',
              subtitle: [titleCaseRole(u.role), u.email].filter(Boolean).join(' · '),
              href: `/hr/users/${u.id}`,
            });
          }

          // Pages where the best-matching person is the subject. Only the top
          // match is expanded: doing it for three users would bury the records
          // under a dozen near-identical rows.
          const top = data.users[0];
          if (top) {
            for (const hit of personContextRoutes(
              { id: top.id, name: top.name ?? '', role: top.role },
              hrefs,
            ).slice(0, MAX_PERSON_PAGES)) {
              nextPersonPages.push({
                key: `person-page:${hit.id}`,
                kind: 'person-page',
                title: hit.label,
                subtitle: 'Jump straight to this record',
                href: hit.href,
              });
            }
          }
        }

        setEntityResults(combined);
        setPersonPages(nextPersonPages);
      } catch {
        // A genuine failure (offline, 5xx) must not leave the PREVIOUS query's
        // records on screen under the new text. An abort is different: the
        // request that replaced it will publish its own results.
        if (!controller.signal.aborted) {
          setEntityResults([]);
          setPersonPages([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [],
  );

  // Records are debounced and still require 2 characters (the server input
  // enforces a 2-char minimum), while pages have already rendered.
  useEffect(() => {
    if (trimmed.length < 2) {
      setEntityResults([]);
      setPersonPages([]);
      setLoading(false);
      if (abortRef.current) abortRef.current.abort();
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => performSearch(trimmed), 250);
    return () => clearTimeout(timer);
  }, [trimmed, performSearch]);

  /**
   * One flat list so ↑/↓ crosses sections. Order is deliberate: the page the
   * user named, then the person-scoped jumps, then the records.
   */
  const results = useMemo(
    () => [...pageResults, ...personPages, ...entityResults],
    [pageResults, personPages, entityResults],
  );

  // Reset the highlight whenever the QUERY changes, not just when the list
  // gets shorter. Keying on `results.length` alone drifted: typing one more
  // character can swap all six page hits for six different ones, leaving the
  // highlight on a row the user never chose and Enter navigating somewhere
  // unintended. The extra guard keeps the index in range when only the
  // async record results land.
  useEffect(() => {
    setSelectedIndex(0);
  }, [trimmed]);
  useEffect(() => {
    setSelectedIndex((i) => (i >= results.length ? 0 : i));
  }, [results.length]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      pushRecentSearchEntry({
        key: result.key,
        title: result.title,
        subtitle: result.subtitle,
        href: result.href,
        kind: result.kind,
      });
      onClose();
      navigate(result.href);
    },
    [navigate, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (results.length ? (i + 1) % results.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault();
        handleSelect(results[selectedIndex]!);
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [results, selectedIndex, handleSelect, onClose],
  );

  // Scroll the highlighted row into view for keyboard-only navigation.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen) return null;

  const showRecents = !trimmed && recents.length > 0;
  const rows: Array<{ result: SearchResult; sectionLabel?: string }> = [];
  let lastKind: SearchResult['kind'] | null = null;
  for (const result of results) {
    const section =
      result.kind === 'page'
        ? 'Pages'
        : result.kind === 'person-page'
          ? 'Jump to'
          : 'Records';
    const prevSection =
      lastKind === null
        ? null
        : lastKind === 'page'
          ? 'Pages'
          : lastKind === 'person-page'
            ? 'Jump to'
            : 'Records';
    rows.push({ result, ...(section !== prevSection ? { sectionLabel: section } : {}) });
    lastKind = result.kind;
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg" backdropBlur contentClassName="p-0 max-h-[85dvh] flex flex-col overflow-hidden border border-app-border bg-app-elevated">
      {/* Search input */}
      <div className="flex items-center gap-3 px-4 border-b border-app-border shrink-0">
        <SearchInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          onKeyDown={handleKeyDown}
          placeholder="Search pages, orders, products, people..."
          wrapperClassName="flex-1"
          clearable={false}
          withSubmitButton={false}
          className="!h-auto !rounded-none !border-0 !bg-transparent !py-3.5 !pr-0 focus:!border-0 focus:!ring-0"
        />
        {loading && (
          <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        )}
        <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-micro text-app-fg-muted bg-app-hover border border-app-border rounded font-mono">
          ESC
        </kbd>
      </div>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
        {rows.length > 0 && (
          <div className="py-2">
            {rows.map(({ result, sectionLabel }, index) => {
              const meta = KIND_LABELS[result.kind];
              return (
                <div key={result.key}>
                  {sectionLabel && (
                    <p className="px-4 pt-2 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted">
                      {sectionLabel}
                    </p>
                  )}
                  <button
                    type="button"
                    data-selected={index === selectedIndex}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-2.5 transition-colors ${
                      index === selectedIndex
                        ? 'bg-brand-50 dark:bg-brand-900/20'
                        : 'hover:bg-app-hover'
                    }`}
                  >
                    <span className={`inline-flex items-center px-1.5 py-0.5 text-micro font-medium rounded ${meta?.color ?? ''}`}>
                      {meta?.label ?? result.kind}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-app-fg truncate">{result.title}</p>
                      <p className="text-xs text-app-fg-muted truncate">{result.subtitle}</p>
                    </div>
                    <svg className="w-4 h-4 text-app-border flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Recents, shown on an empty query so the palette is useful before typing. */}
        {showRecents && (
          <div className="py-2">
            <p className="px-4 pt-2 pb-1 text-micro font-semibold uppercase tracking-wide text-app-fg-muted">
              Recent
            </p>
            {recents.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() =>
                  handleSelect({
                    key: entry.key,
                    kind: entry.kind,
                    title: entry.title,
                    subtitle: entry.subtitle,
                    href: entry.href,
                  })
                }
                className="w-full text-left flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-app-hover"
              >
                <svg className="w-4 h-4 text-app-fg-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-app-fg truncate">{entry.title}</p>
                  <p className="text-xs text-app-fg-muted truncate">{entry.subtitle}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Empty state. While records are still loading we say so, because the
            page list above may already be empty for a record-only query. */}
        {trimmed.length > 0 && rows.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-app-fg-muted">
              {loading ? `Searching for "${trimmed}"...` : `No results found for "${trimmed}"`}
            </p>
            {!loading && trimmed.length < 2 && (
              <p className="mt-1 text-xs text-app-fg-muted">
                Type one more character to search orders, products and people.
              </p>
            )}
          </div>
        )}

        {!trimmed && !showRecents && (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-app-fg-muted">
              Search for a page, an order, a product or a person.
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-app-border shrink-0 flex items-center gap-4 text-mini text-app-fg-muted pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <span className="flex items-center gap-1">
          <kbd className="px-1 py-0.5 bg-app-hover border border-app-border rounded font-mono text-micro">↑↓</kbd>
          Navigate
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1 py-0.5 bg-app-hover border border-app-border rounded font-mono text-micro">↵</kbd>
          Select
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1 py-0.5 bg-app-hover border border-app-border rounded font-mono text-micro">esc</kbd>
          Close
        </span>
      </div>
    </Modal>
  );
}

/**
 * Hook to open the search modal with Cmd+K / Ctrl+K.
 */
export function useSearchShortcut(onOpen: () => void) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpen();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onOpen]);
}
