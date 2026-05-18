import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Form, useFetchers } from '@remix-run/react';
import { Modal } from './modal';
import { Button } from './button';
import { isMirrorBlockedError } from '~/lib/mirror-mode';

interface MirrorReadOnlyContextValue {
  /** Show the read-only modal. Safe to call multiple times — no-ops if already open. */
  show: () => void;
}

const MirrorReadOnlyContext = createContext<MirrorReadOnlyContextValue | null>(null);

/**
 * Returns `show()` to open the Mirror Mode read-only modal. Used by the global
 * submit interceptor and the fetcher-data watcher; components rarely call it
 * directly because the interceptor catches form submits before they fire.
 */
export function useMirrorReadOnly(): MirrorReadOnlyContextValue {
  return useContext(MirrorReadOnlyContext) ?? { show: () => {} };
}

interface ProviderProps {
  /** Display name of the user the admin is mirroring (for the modal copy). */
  targetName?: string;
  /** Display name of the original admin (shown so they remember whose hat they're wearing). */
  actorName?: string;
  children: React.ReactNode;
}

/**
 * Wraps the dashboard with the read-only modal + the global fetcher watcher.
 * Mounted by DashboardLayout when `user.mirroredBy` is present.
 */
export function MirrorReadOnlyProvider({ targetName, actorName, children }: ProviderProps) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);

  const ctx = useMemo(() => ({ show }), [show]);

  return (
    <MirrorReadOnlyContext.Provider value={ctx}>
      {children}
      <MirrorBlockedFetcherWatcher onBlocked={show} />
      <MirrorReadOnlyModal
        open={open}
        onClose={hide}
        targetName={targetName}
        actorName={actorName}
      />
    </MirrorReadOnlyContext.Provider>
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  targetName?: string;
  actorName?: string;
}

function MirrorReadOnlyModal({ open, onClose, targetName, actorName }: ModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="max-w-md"
      backdropBlur
      role="alertdialog"
      aria-labelledby="mirror-readonly-title"
      aria-describedby="mirror-readonly-desc"
      contentClassName="border border-success-300 dark:border-success-600/60"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-11 h-11 rounded-full bg-success-100 dark:bg-success-700/30 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-success-600 dark:text-success-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="mirror-readonly-title" className="text-base font-semibold text-app-fg">
              Mirror mode is read-only
            </h2>
            <p id="mirror-readonly-desc" className="text-sm text-app-fg-muted mt-1.5 leading-relaxed">
              {targetName ? (
                <>
                  You're viewing the app as <span className="font-medium text-app-fg">{targetName}</span>
                  {actorName ? <> while signed in as <span className="font-medium text-app-fg">{actorName}</span></> : null}
                  . To protect data integrity, no changes can be made on their behalf.
                </>
              ) : (
                <>
                  You're viewing this account in mirror mode. To protect data integrity, no
                  changes can be made on the user's behalf.
                </>
              )}
            </p>
            <p className="text-xs text-app-fg-muted mt-2">
              Exit mirror to make changes from your own account.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Got it
          </Button>
          <Form
            method="post"
            action="/admin"
            data-mirror-allow=""
            className="inline-flex"
            onSubmit={onClose}
          >
            <input type="hidden" name="intent" value="exitMirror" />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="bg-success-600 hover:bg-success-700 focus:ring-success-500 dark:bg-success-600 dark:hover:bg-success-700"
            >
              Exit mirror mode
            </Button>
          </Form>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Watches every Remix fetcher result. When any fetcher returns the mirror-blocked
 * error string, opens the modal once per fetcher response. This is the safety net
 * for programmatic mutations (`fetcher.submit(...)`) that the submit interceptor
 * can't catch — those still hit the server, get rejected by `blockMutationsWhileMirroring`,
 * and the action handler forwards the message back through `fetcher.data.error`.
 */
function MirrorBlockedFetcherWatcher({ onBlocked }: { onBlocked: () => void }) {
  const fetchers = useFetchers();
  // Track which fetcher responses we've already surfaced — a fetcher's `key` is
  // stable across renders, but we want to re-trigger if the same fetcher is
  // re-submitted and lands on the blocked state again. We forget the key the
  // moment the fetcher leaves idle, so the next idle-with-error counts fresh.
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const f of fetchers) {
      const key = (f as { key?: string }).key ?? '';
      if (!key) continue;
      if (f.state !== 'idle') {
        seenRef.current.delete(key);
        continue;
      }
      if (!isMirrorBlockedError(f.data)) continue;
      if (seenRef.current.has(key)) continue;
      seenRef.current.add(key);
      onBlocked();
    }
  }, [fetchers, onBlocked]);

  return null;
}
