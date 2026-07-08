import { useSearchParams } from '@remix-run/react';

/**
 * Consolidated toggle — URL param ?consolidated=true switches the report
 * to aggregate across all companies (branch groups). SuperAdmin/Admin only.
 */
export function ConsolidatedToggle({ active }: { active?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const toggle = () => {
    const next = new URLSearchParams(searchParams);
    if (active) {
      next.delete('consolidated');
    } else {
      next.set('consolidated', 'true');
    }
    setSearchParams(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
          : 'bg-app-bg-secondary text-app-fg-muted hover:bg-app-bg-tertiary',
      ].join(' ')}
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
      {active ? 'Consolidated' : 'Consolidate'}
    </button>
  );
}
