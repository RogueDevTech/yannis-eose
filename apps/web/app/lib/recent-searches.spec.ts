import { describe, it, expect } from 'vitest';
import { loadRecentSearchEntries, pushRecentSearchEntry, clearRecentSearchEntries } from './recent-searches';

/** Minimal localStorage stand-in — the module must tolerate throwing too. */
function installStorage(impl?: Partial<Storage>) {
  const store = new Map<string, string>();
  const base: Storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
  // @ts-expect-error test shim
  globalThis.window = { localStorage: { ...base, ...impl } };
}

const entry = {
  key: 'page:/admin/finance',
  title: 'Finance',
  subtitle: 'FINANCE',
  href: '/admin/finance',
  kind: 'page' as const,
};

describe('recent searches', () => {
  it('round-trips an entry, most recent first, de-duped', () => {
    installStorage();
    pushRecentSearchEntry(entry);
    pushRecentSearchEntry({ ...entry, key: 'page:/hr/users', title: 'Users', href: '/hr/users' });
    pushRecentSearchEntry(entry); // re-open the first one
    const got = loadRecentSearchEntries();
    expect(got.map((e) => e.key)).toEqual(['page:/admin/finance', 'page:/hr/users']);
  });

  it('caps the list', () => {
    installStorage();
    for (let i = 0; i < 12; i++) pushRecentSearchEntry({ ...entry, key: `k${i}`, href: `/p${i}` });
    expect(loadRecentSearchEntries()).toHaveLength(6);
  });

  // The guard the module claims: a stored href must stay inside the app.
  it.each([
    ['//evil.com', 'protocol-relative'],
    ['/\\evil.com', 'backslash normalises to protocol-relative'],
    ['javascript:alert(1)', 'scheme'],
    ['https://evil.com', 'absolute'],
    ['relative/path', 'not rooted'],
  ])('rejects %s (%s)', (href) => {
    installStorage();
    pushRecentSearchEntry({ ...entry, href });
    expect(loadRecentSearchEntries()).toEqual([]);
  });

  it('accepts a normal in-app href with a query string', () => {
    installStorage();
    pushRecentSearchEntry({ ...entry, href: '/admin/marketing/orders?mediaBuyerId=abc' });
    expect(loadRecentSearchEntries()).toHaveLength(1);
  });

  it('survives corrupt stored JSON', () => {
    installStorage();
    window.localStorage.setItem('yannis_recent_searches_v1', '{not json');
    expect(loadRecentSearchEntries()).toEqual([]);
  });

  it('survives storage that throws on read and on write', () => {
    installStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadRecentSearchEntries()).toEqual([]);
    expect(() => pushRecentSearchEntry(entry)).not.toThrow();
  });

  it('clears', () => {
    installStorage();
    pushRecentSearchEntry(entry);
    clearRecentSearchEntries();
    expect(loadRecentSearchEntries()).toEqual([]);
  });
});
