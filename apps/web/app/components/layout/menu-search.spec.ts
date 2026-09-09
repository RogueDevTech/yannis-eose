import { describe, it, expect } from 'vitest';
import { buildMenuSearchResults, type MenuSearchGroup, type MenuSearchItem } from './menu-search';

const groups: Array<MenuSearchGroup<MenuSearchItem>> = [
  {
    group: 'FINANCE',
    items: [
      {
        label: 'Finance',
        href: '/admin/finance',
        tabs: [
          { value: 'remittance', label: 'Cash remittance' },
          { value: 'disbursements', label: 'Disbursements' },
          { value: 'payroll', label: 'Payroll' },
        ],
      },
    ],
  },
  {
    group: 'CONFIG',
    items: [
      { label: 'Notifications', href: '/admin/notifications' },
      {
        label: 'Settings',
        href: '/admin/settings',
        tabs: [
          { value: 'profile', label: 'Profile' },
          { value: 'security', label: 'Security' },
        ],
      },
    ],
  },
];

describe('buildMenuSearchResults', () => {
  it('still matches pages by their own label', () => {
    const r = buildMenuSearchResults(groups, 'notif');
    expect(r).toHaveLength(1);
    expect(r[0]!.item.label).toBe('Notifications');
    expect(r[0]!.tabLabel).toBeUndefined();
  });

  // The feature: a section inside a page is reachable from the sidebar.
  it('matches a tab inside a page and deep-links to it', () => {
    const r = buildMenuSearchResults(groups, 'remittance');
    expect(r).toHaveLength(1);
    expect(r[0]!.item.href).toBe('/admin/finance?tab=remittance');
    expect(r[0]!.tabLabel).toBe('Cash remittance');
    expect(r[0]!.item.label).toBe('Finance'); // caller renders "Finance › Cash remittance"
  });

  it('does not expand a page into all its tabs when the page label itself matches', () => {
    // "settings" should list Settings once, not once per tab.
    const r = buildMenuSearchResults(groups, 'settings');
    expect(r).toHaveLength(1);
    expect(r[0]!.item.href).toBe('/admin/settings');
    expect(r[0]!.tabLabel).toBeUndefined();
  });

  it('matches on group name and keeps every page in that group', () => {
    const r = buildMenuSearchResults(groups, 'config');
    expect(r.map((x) => x.item.label)).toEqual(['Notifications', 'Settings']);
  });

  it('is case-insensitive', () => {
    expect(buildMenuSearchResults(groups, 'PAYROLL')).toHaveLength(1);
    expect(buildMenuSearchResults(groups, 'payroll')[0]!.item.href).toBe(
      '/admin/finance?tab=payroll',
    );
  });

  it('can return several tab hits from one page', () => {
    // "s" hits Disbursements + Settings/Security etc — narrow to one page's tabs.
    const r = buildMenuSearchResults(
      [groups[0]!],
      'r', // Cash remittance, Disbursements, Payroll all contain "r"
    );
    expect(r.every((x) => x.item.href.startsWith('/admin/finance?tab='))).toBe(true);
    expect(r.length).toBeGreaterThan(1);
  });

  it('url-encodes the tab value', () => {
    const r = buildMenuSearchResults(
      [{ group: null, items: [{ label: 'P', href: '/p', tabs: [{ value: 'a b&c', label: 'Zed' }] }] }],
      'zed',
    );
    expect(r[0]!.item.href).toBe('/p?tab=a%20b%26c');
  });

  it('returns nothing for an empty query', () => {
    expect(buildMenuSearchResults(groups, '')).toEqual([]);
  });

  it('returns nothing when neither a page nor a tab matches', () => {
    expect(buildMenuSearchResults(groups, 'zzzz')).toEqual([]);
  });

  it('handles items with no tabs', () => {
    const r = buildMenuSearchResults(
      [{ group: null, items: [{ label: 'Dashboard', href: '/admin' }] }],
      'dash',
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.item.href).toBe('/admin');
  });
});
