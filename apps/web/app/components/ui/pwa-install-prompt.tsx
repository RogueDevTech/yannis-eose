import { Button } from '~/components/ui/button';

interface PwaInstallPromptProps {
  open: boolean;
  isIosInstructions: boolean;
  onInstall: () => void;
  onClose: () => void;
}

export function PwaInstallPrompt({
  open,
  isIosInstructions,
  onInstall,
  onClose,
}: PwaInstallPromptProps) {
  if (!open) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[95] flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:inset-x-auto md:right-6 md:bottom-6 md:px-0 md:pb-0">
      <section
        role="status"
        aria-live="polite"
        aria-label="Install app prompt"
        className="pointer-events-auto w-full max-w-sm rounded-2xl border border-surface-200 bg-white/95 p-3 shadow-[0_18px_40px_-14px_rgba(15,23,42,0.3),0_10px_22px_-10px_rgba(15,23,42,0.22)] ring-1 ring-black/5 backdrop-blur-sm transition-all duration-300 animate-fade-in dark:border-surface-200 dark:bg-white/95"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-5 text-surface-900">Install Yannis App</h3>
            <p className="mt-0.5 text-xs leading-4 text-surface-700">
              Add Yannis to your home screen for faster access and better offline reliability.
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss install prompt"
            className="rounded-md p-1 text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-800"
            onClick={onClose}
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {isIosInstructions ? (
          <details className="mt-2 rounded-lg border border-surface-200 bg-surface-50 px-2.5 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-surface-800">
              iPhone/iPad install steps
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-surface-700">
              <li>Tap the Share icon in Safari.</li>
              <li>Select Add to Home Screen.</li>
              <li>Tap Add to finish.</li>
            </ol>
          </details>
        ) : null}

        <div className="mt-2 flex items-center justify-end gap-1.5">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            {isIosInstructions ? 'Got it' : 'Not now'}
          </Button>
          {!isIosInstructions ? (
            <Button type="button" variant="primary" size="sm" onClick={onInstall}>
              Install
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
