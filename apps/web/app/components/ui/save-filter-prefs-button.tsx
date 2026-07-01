import { useState } from 'react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { useToast } from '~/components/ui/toast';
import { useFilterPreferences } from '~/hooks/useFilterPreferences';

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

interface SaveFilterPrefsButtonProps {
  pageKey: string;
  /** Additional class names for the button. */
  className?: string;
}

/**
 * Small bookmark icon for page headers. Saves/clears the current URL filter
 * params as the user's default for this page. Shows filled when prefs exist.
 */
export function SaveFilterPrefsButton({ pageKey, className = '' }: SaveFilterPrefsButtonProps) {
  const { hasSavedPrefs, saveCurrentFilters, clearSavedFilters, isSaving } = useFilterPreferences(pageKey);
  const [showModal, setShowModal] = useState(false);
  const { toast } = useToast();

  const handleSave = () => {
    saveCurrentFilters();
    setShowModal(false);
    toast.success('Filter defaults saved');
  };

  const handleClear = () => {
    clearSavedFilters();
    setShowModal(false);
    toast.info('Filter defaults cleared');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        disabled={isSaving}
        className={`inline-flex items-center justify-center rounded-md p-1.5 text-app-fg-muted hover:text-brand-500 dark:hover:text-brand-400 hover:bg-app-bg-hover transition-colors ${className}`}
        title={hasSavedPrefs ? 'Saved filter defaults (click to manage)' : 'Save current filters as default'}
      >
        {hasSavedPrefs ? (
          <BookmarkFilledIcon className="h-4 w-4 text-brand-500 dark:text-brand-400" />
        ) : (
          <BookmarkOutlineIcon className="h-4 w-4" />
        )}
      </button>

      <Modal open={showModal} onClose={() => setShowModal(false)}>
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-app-fg">Filter Defaults</h3>
          <p className="text-sm text-app-fg-muted">
            {hasSavedPrefs
              ? 'This page has saved filter defaults. You can update them with your current filters or clear them.'
              : 'Save your current filters as the default for this page. They will be applied automatically when you visit without specific filters.'}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              {hasSavedPrefs ? 'Update defaults' : 'Save as default'}
            </Button>
            {hasSavedPrefs && (
              <Button size="sm" variant="ghost" onClick={handleClear} disabled={isSaving}>
                Clear defaults
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
