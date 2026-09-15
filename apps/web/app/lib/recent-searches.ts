/**
 * Recently opened command-palette results, per browser.
 *
 * Opening Cmd+K with nothing typed used to show a "type at least 2
 * characters" hint, which is a dead panel at the exact moment the user is
 * deciding where to go. Recents make it useful immediately, and the pages
 * people revisit are a very short list in practice.
 *
 * `localStorage`, deliberately: this is a per-device convenience, not state
 * worth a round-trip, and every access is wrapped because a private window or
 * blocked site data makes even reading it throw.
 */

const STORAGE_KEY = 'yannis_recent_searches_v1';
const MAX_ENTRIES = 6;

export interface RecentSearchEntry {
  /** Stable identity, e.g. `page:/admin/finance` or `order:<uuid>`. */
  key: string;
  title: string;
  subtitle: string;
  href: string;
  kind: 'page' | 'person-page' | 'order' | 'product' | 'user';
}

function isEntry(value: unknown): value is RecentSearchEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.key === 'string' &&
    typeof e.title === 'string' &&
    typeof e.href === 'string' &&
    isInAppHref(e.href)
  );
}

/**
 * An href out of storage gets handed to `navigate()`, so it must be a path
 * within this app.
 *
 * `startsWith('/') && !startsWith('//')` is not enough: browsers normalise a
 * backslash to a forward slash in the authority position, so `/\evil.com`
 * resolves to `https://evil.com/` and would navigate off-site. A colon before
 * the first slash would likewise admit a scheme. Exploiting this needs
 * attacker-controlled localStorage (XSS or local access) so it is hardening
 * rather than a live hole, but the guard is claimed, so it should hold.
 */
function isInAppHref(href: string): boolean {
  if (!href.startsWith('/')) return false;
  if (href.startsWith('//')) return false;
  if (href.includes('\\')) return false;
  // No scheme: reject a colon appearing before the first path separator.
  const firstSlash = href.indexOf('/', 1);
  const head = firstSlash === -1 ? href : href.slice(0, firstSlash);
  if (head.includes(':')) return false;
  return true;
}

export function loadRecentSearchEntries(): RecentSearchEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isEntry)
      .slice(0, MAX_ENTRIES)
      .map((e) => ({ ...e, subtitle: typeof e.subtitle === 'string' ? e.subtitle : '' }));
  } catch {
    return [];
  }
}

/** Most-recent-first, de-duped by `key`, capped at `MAX_ENTRIES`. */
export function pushRecentSearchEntry(entry: RecentSearchEntry): void {
  if (typeof window === 'undefined') return;
  if (!isEntry(entry)) return;
  try {
    const next = [entry, ...loadRecentSearchEntries().filter((e) => e.key !== entry.key)].slice(
      0,
      MAX_ENTRIES,
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked — recents are a convenience, never a failure.
  }
}

export function clearRecentSearchEntries(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
