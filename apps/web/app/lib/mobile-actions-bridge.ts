/**
 * Bridge between PageHeaderMobileTools (owns the Actions sheet modal) and
 * MobileDateFilterRow (renders the visible Actions button on mobile).
 *
 * Uses a small stack so React Strict Mode / accidental double mounts cannot
 * delete the live opener out from under the toolbar.
 */

export type MobileActionsOpener = () => void;

const openers: MobileActionsOpener[] = [];

declare global {
  interface Window {
    __openMobileActionsSheet?: MobileActionsOpener;
  }
}

export const MOBILE_ACTIONS_CHANGED_EVENT = 'yannis:mobile-actions-changed';

function publish() {
  if (typeof window === 'undefined') return;
  const top = openers[openers.length - 1];
  if (top) window.__openMobileActionsSheet = top;
  else delete window.__openMobileActionsSheet;
  window.dispatchEvent(new Event(MOBILE_ACTIONS_CHANGED_EVENT));
}

export function registerMobileActionsOpener(open: MobileActionsOpener): () => void {
  openers.push(open);
  publish();
  return () => {
    const idx = openers.lastIndexOf(open);
    if (idx >= 0) openers.splice(idx, 1);
    publish();
  };
}

export function hasMobileActionsOpener(): boolean {
  return openers.length > 0;
}

export function openMobileActionsSheet(): void {
  const top = openers[openers.length - 1];
  if (top) {
    top();
    return;
  }
  // Fallback for HMR / brief mount gaps
  if (typeof window !== 'undefined') {
    window.__openMobileActionsSheet?.();
  }
}
