/**
 * Bridge between PageSearchControl (owns the search modal, lives inside the
 * desktop-only toolbar) and MobileDateFilterRow (renders the visible Search
 * button on mobile). The toolbar is `hidden md:block`, so its search button
 * never shows on mobile; this lets the mobile row surface an equivalent one.
 *
 * Mirrors mobile-actions-bridge: a small stack so React Strict Mode / accidental
 * double mounts cannot delete the live opener out from under the toolbar.
 */

export type MobileSearchOpener = () => void;

const openers: MobileSearchOpener[] = [];

declare global {
  interface Window {
    __openMobileSearchSheet?: MobileSearchOpener;
  }
}

export const MOBILE_SEARCH_CHANGED_EVENT = 'yannis:mobile-search-changed';

function publish() {
  if (typeof window === 'undefined') return;
  const top = openers[openers.length - 1];
  if (top) window.__openMobileSearchSheet = top;
  else delete window.__openMobileSearchSheet;
  window.dispatchEvent(new Event(MOBILE_SEARCH_CHANGED_EVENT));
}

export function registerMobileSearchOpener(open: MobileSearchOpener): () => void {
  openers.push(open);
  publish();
  return () => {
    const idx = openers.lastIndexOf(open);
    if (idx >= 0) openers.splice(idx, 1);
    publish();
  };
}

export function hasMobileSearchOpener(): boolean {
  return openers.length > 0;
}

export function openMobileSearchSheet(): void {
  const top = openers[openers.length - 1];
  if (top) {
    top();
    return;
  }
  // Fallback for HMR / brief mount gaps
  if (typeof window !== 'undefined') {
    window.__openMobileSearchSheet?.();
  }
}
