import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { SearchInput } from '~/components/ui/search-input';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';

interface SearchResult {
  id: string;
  type: 'order' | 'product' | 'user';
  title: string;
  subtitle: string;
  href: string;
}

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  order: { label: 'Order', color: 'bg-brand-100 text-brand-700 dark:bg-brand-700/20 dark:text-brand-400' },
  product: { label: 'Product', color: 'bg-success-100 text-success-700 dark:bg-success-700/20 dark:text-success-400' },
  user: { label: 'User', color: 'bg-info-100 text-info-700 dark:bg-info-700/20 dark:text-info-400' },
};

export function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const abortRef = useRef<AbortController | null>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => {
      performSearch(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const performSearch = useCallback(async (q: string) => {
    // Cancel previous request
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
      if (!data) { setResults([]); return; }

      const combined: SearchResult[] = [];
      const seenIds = new Set<string>();

      // Main orders
      if (Array.isArray(data.orders)) {
        for (const o of data.orders.slice(0, 5)) {
          if (seenIds.has(o.id)) continue;
          seenIds.add(o.id);
          combined.push({
            id: o.id,
            type: 'order',
            title: o.customerName || 'Unnamed Order',
            subtitle: `${o.status?.replace(/_/g, ' ')} ${o.totalAmount ? `· ₦${parseFloat(o.totalAmount).toLocaleString()}` : ''}`,
            href: `/admin/orders/${o.id}`,
          });
        }
      }

      // Follow-up orders
      if (Array.isArray(data.followUpOrders)) {
        for (const o of data.followUpOrders.slice(0, 5)) {
          if (seenIds.has(o.id)) continue;
          seenIds.add(o.id);
          combined.push({
            id: o.id,
            type: 'order',
            title: o.customerName || 'Unnamed Order',
            subtitle: `Follow-up · ${o.status?.replace(/_/g, ' ')} ${o.totalAmount ? `· ₦${parseFloat(o.totalAmount).toLocaleString()}` : ''}`,
            href: `/admin/orders/${o.id}?from=followup`,
          });
        }
      }

      // Cart orders
      if (Array.isArray(data.cartOrders)) {
        for (const o of data.cartOrders.slice(0, 5)) {
          if (seenIds.has(o.id)) continue;
          seenIds.add(o.id);
          combined.push({
            id: o.id,
            type: 'order',
            title: o.customerName || 'Unnamed Order',
            subtitle: `Cart · ${o.status?.replace(/_/g, ' ')} ${o.totalAmount ? `· ₦${parseFloat(o.totalAmount).toLocaleString()}` : ''}`,
            href: `/admin/orders/${o.id}?from=cart-orders`,
          });
        }
      }

      // Products
      if (Array.isArray(data.products)) {
        for (const p of data.products.slice(0, 3)) {
          combined.push({
            id: p.id,
            type: 'product',
            title: p.name || 'Unnamed Product',
            subtitle: `${((p.offers as Array<{label: string}>) ?? []).length || 0} offers · ₦${parseFloat(p.baseSalePrice ?? '0').toLocaleString()}`,
            href: '/admin/products',
          });
        }
      }

      // Users
      if (Array.isArray(data.users)) {
        for (const u of data.users.slice(0, 3)) {
          const role = u.role?.split('_').map((w: string) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ') ?? '';
          combined.push({
            id: u.id,
            type: 'user',
            title: u.name || 'Unnamed User',
            subtitle: `${role} · ${u.email ?? ''}`,
            href: '/hr/users',
          });
        }
      }

      setResults(combined);
      setSelectedIndex(0);
    } catch {
      // Aborted or network error — ignore
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      onClose();
      navigate(result.href);
    },
    [navigate, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault();
        handleSelect(results[selectedIndex]);
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [results, selectedIndex, handleSelect, onClose],
  );

  if (!isOpen) return null;

  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg" backdropBlur contentClassName="p-0 max-h-[85dvh] flex flex-col overflow-hidden border border-app-border bg-app-elevated">
      {/* Search input */}
      <div className="flex items-center gap-3 px-4 border-b border-app-border shrink-0">
        <SearchInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          onKeyDown={handleKeyDown}
          placeholder="Search orders, products, users..."
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

          {/* Results + empty + hint */}
          <div className="flex-1 min-h-0 overflow-y-auto">
          {results.length > 0 && (
            <div className="py-2">
              {results.map((result, index) => {
                const meta = TYPE_LABELS[result.type];
                return (
                  <button
                    key={`${result.type}-${result.id}`}
                    type="button"
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-2.5 transition-colors ${
                      index === selectedIndex
                        ? 'bg-brand-50 dark:bg-brand-900/20'
                        : 'hover:bg-app-hover'
                    }`}
                  >
                    <span className={`inline-flex items-center px-1.5 py-0.5 text-micro font-medium rounded ${meta?.color ?? ''}`}>
                      {meta?.label ?? result.type}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-app-fg truncate">
                        {result.title}
                      </p>
                      <p className="text-xs text-app-fg-muted truncate">
                        {result.subtitle}
                      </p>
                    </div>
                    <svg className="w-4 h-4 text-app-border flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {query.length >= 2 && !loading && results.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-app-fg-muted">
                No results found for "{query}"
              </p>
            </div>
          )}

          {/* Hint */}
          {query.length < 2 && results.length === 0 && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-app-fg-muted">
                Type at least 2 characters to search
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
