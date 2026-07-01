import { useState, useCallback, useEffect, useContext } from 'react';
import { useSearchParams } from '@remix-run/react';
import { FilterPrefsContext } from '~/hooks/useFilterPreferences';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { useToast } from '~/components/ui/toast';

function BookmarkOutlineIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
    </svg>
  );
}

function BookmarkFilledIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M6.32 2.577a49.255 49.255 0 0 1 11.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 0 1-1.085.67L12 18.089l-7.165 3.583A.75.75 0 0 1 3.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93Z" clipRule="evenodd" />
    </svg>
  );
}

const PERSISTABLE_PARAMS = new Set([
  'startDate', 'endDate', 'period', 'status', 'mediaBuyerId', 'csCloserId',
  'productId', 'campaignId', 'fromLocationId', 'toLocationId', 'locationId',
  'branchId', 'perPage', 'fromCart', 'testOrders', 'sortBy', 'sortOrder', 'sortDir',
]);

const API_PATH = '/api/filter-preferences';

interface SaveFilterPrefsButtonProps {
  pageKey: string;
  /** Pass from useFilterPreferences hook to avoid duplicate fetches. */
  hasSavedPrefs?: boolean;
  /** Whether current URL filters differ from saved prefs. */
  filtersChanged?: boolean;
  className?: string;
}

/**
 * Standalone save button — does NOT fetch preferences on mount.
 * Only saves/clears via direct API calls when user clicks.
 * No duplicate network requests.
 */
export function SaveFilterPrefsButton({ pageKey, hasSavedPrefs: hasSavedPrefsProp = false, filtersChanged = false, className = '' }: SaveFilterPrefsButtonProps) {
  const [searchParams] = useSearchParams();
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  // localHasSaved mirrors the prop; mutations flip it locally for instant feedback.
  const [localHasSaved, setLocalHasSaved] = useState(hasSavedPrefsProp);
  const { toast } = useToast();
  const { setPagePrefs } = useContext(FilterPrefsContext);

  // Keep in sync when the prop changes (e.g. after context hydrates or a save
  // in a sibling hook updates the context).
  useEffect(() => {
    setLocalHasSaved(hasSavedPrefsProp);
  }, [hasSavedPrefsProp]);

  const doSave = useCallback(() => {
    const filters: Record<string, string> = {};
    for (const key of PERSISTABLE_PARAMS) {
      const value = searchParams.get(key);
      if (value) filters[key] = value;
    }
    // Normalize: period=all_time makes startDate/endDate redundant
    if (filters.period === 'all_time') {
      delete filters.startDate;
      delete filters.endDate;
    }
    if (Object.keys(filters).length === 0) return;

    setSaving(true);
    fetch(API_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'upsert', pageKey, filters }),
    })
      .then(() => { setLocalHasSaved(true); setPagePrefs(pageKey, filters); toast.success('Filter defaults saved'); setShowModal(false); })
      .catch(() => toast.error('Failed to save'))
      .finally(() => setSaving(false));
  }, [searchParams, pageKey, toast, setPagePrefs]);

  const doClear = useCallback(() => {
    setSaving(true);
    fetch(API_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'delete', pageKey }),
    })
      .then(() => { setLocalHasSaved(false); setPagePrefs(pageKey, null); toast.info('Filter defaults cleared'); setShowModal(false); })
      .catch(() => toast.error('Failed to clear'))
      .finally(() => setSaving(false));
  }, [pageKey, toast, setPagePrefs]);

  const handleClick = () => {
    setShowModal(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={saving}
        className={`btn-secondary btn-sm gap-1.5 ${className}`}
        title={localHasSaved ? 'Manage saved filter defaults' : 'Save current filters as default'}
      >
        {localHasSaved && !filtersChanged ? (
          <BookmarkFilledIcon className="h-4 w-4 text-brand-500 dark:text-brand-400" />
        ) : (
          <BookmarkOutlineIcon className="h-4 w-4" />
        )}
        <span>{localHasSaved && !filtersChanged ? 'Saved filters' : 'Save filters'}</span>
      </button>

      <Modal open={showModal} onClose={() => setShowModal(false)} maxWidth="max-w-sm" contentClassName="p-5">
        <h3 className="text-base font-semibold text-app-fg">Filter Defaults</h3>
        <p className="mt-2 text-sm text-app-fg-muted">
          {localHasSaved
            ? 'Update your saved defaults with the current filters, or clear them to use system defaults.'
            : 'Save your current filters as the default for this page. They will be applied automatically when you visit.'}
        </p>
        <div className="mt-5 flex items-center gap-3">
          <Button size="sm" onClick={() => doSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save filters'}
          </Button>
          {localHasSaved && (
            <Button size="sm" variant="secondary" onClick={() => doClear()} disabled={saving}>
              Clear defaults
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setShowModal(false)} disabled={saving}>
            Cancel
          </Button>
        </div>
      </Modal>
    </>
  );
}
