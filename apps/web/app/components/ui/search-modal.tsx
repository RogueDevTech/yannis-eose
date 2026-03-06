import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from '@remix-run/react';

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
      const apiUrl = window.__ENV?.API_URL || 'http://localhost:4000';
      const searchParam = encodeURIComponent(JSON.stringify({ search: q, limit: 5 }));

      const [ordersRes, productsRes, usersRes] = await Promise.all([
        fetch(`${apiUrl}/trpc/orders.list?input=${searchParam}`, {
          credentials: 'include',
          signal: controller.signal,
        }).then((r) => r.json()).catch(() => null),
        fetch(`${apiUrl}/trpc/products.list?input=${searchParam}`, {
          credentials: 'include',
          signal: controller.signal,
        }).then((r) => r.json()).catch(() => null),
        fetch(`${apiUrl}/trpc/users.list?input=${searchParam}`, {
          credentials: 'include',
          signal: controller.signal,
        }).then((r) => r.json()).catch(() => null),
      ]);

      if (controller.signal.aborted) return;

      const combined: SearchResult[] = [];

      // Parse orders
      const orders = ordersRes?.result?.data?.orders;
      if (Array.isArray(orders)) {
        for (const o of orders.slice(0, 5)) {
          combined.push({
            id: o.id,
            type: 'order',
            title: o.customerName || 'Unnamed Order',
            subtitle: `${o.status?.replace(/_/g, ' ')} ${o.totalAmount ? `· ₦${parseFloat(o.totalAmount).toLocaleString()}` : ''}`,
            href: `/admin/orders/${o.id}`,
          });
        }
      }

      // Parse products
      const products = productsRes?.result?.data?.products;
      if (Array.isArray(products)) {
        for (const p of products.slice(0, 3)) {
          combined.push({
            id: p.id,
            type: 'product',
            title: p.name || 'Unnamed Product',
            subtitle: `${((p.offers as Array<{label: string}>) ?? []).length || 0} offers · ₦${parseFloat(p.baseSalePrice ?? '0').toLocaleString()}`,
            href: '/admin/products',
          });
        }
      }

      // Parse users
      const users = usersRes?.result?.data?.users;
      if (Array.isArray(users)) {
        for (const u of users.slice(0, 3)) {
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
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="rounded-xl bg-white dark:bg-surface-800 shadow-2xl border border-surface-200 dark:border-surface-700 overflow-hidden flex flex-col w-full max-w-lg max-h-[85dvh] animate-fade-in" onClick={(e) => e.stopPropagation()}>
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 border-b border-surface-100 dark:border-surface-700 shrink-0">
            <svg className="w-5 h-5 text-surface-700 flex-shrink-0 dark:text-surface-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search orders, products, users..."
              className="flex-1 py-3.5 bg-transparent border-0 text-sm text-surface-900 dark:text-white placeholder:text-surface-600 dark:placeholder:text-surface-400 focus:outline-none focus:ring-0"
            />
            {loading && (
              <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            )}
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] text-surface-700 bg-surface-100 dark:bg-surface-700 dark:text-surface-200 rounded font-mono">
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
                        : 'hover:bg-surface-50 dark:hover:bg-surface-700/30'
                    }`}
                  >
                    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${meta?.color ?? ''}`}>
                      {meta?.label ?? result.type}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-900 dark:text-white truncate">
                        {result.title}
                      </p>
                      <p className="text-xs text-surface-800 dark:text-surface-200 truncate">
                        {result.subtitle}
                      </p>
                    </div>
                    <svg className="w-4 h-4 text-surface-300 dark:text-surface-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
              <p className="text-sm text-surface-700 dark:text-surface-300">
                No results found for "{query}"
              </p>
            </div>
          )}

          {/* Hint */}
          {query.length < 2 && results.length === 0 && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-surface-700 dark:text-surface-300">
                Type at least 2 characters to search
              </p>
            </div>
          )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-surface-100 dark:border-surface-700 shrink-0 flex items-center gap-4 text-[11px] text-surface-700 dark:text-surface-300 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-surface-100 dark:bg-surface-700 rounded font-mono text-[10px]">↑↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-surface-100 dark:bg-surface-700 rounded font-mono text-[10px]">↵</kbd>
              Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-surface-100 dark:bg-surface-700 rounded font-mono text-[10px]">esc</kbd>
              Close
            </span>
          </div>
        </div>
      </div>
    </>
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
