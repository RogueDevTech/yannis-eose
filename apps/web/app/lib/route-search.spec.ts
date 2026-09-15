import { describe, it, expect } from 'vitest';
import { searchRoutes, personContextRoutes, type RouteSearchGroup } from './route-search';

const groups: Array<RouteSearchGroup> = [
  {
    group: 'FINANCE',
    items: [
      {
        label: 'Finance',
        href: '/admin/finance',
        keywords: ['accounting', 'ledger'],
        tabs: [
          { value: 'remittance', label: 'Cash remittance' },
          { value: 'payroll', label: 'Payroll', keywords: ['salary', 'wages'] },
        ],
      },
      { label: 'Funnel Orders', href: '/admin/sales/orders' },
    ],
  },
  {
    group: 'HR',
    items: [
      { label: 'Users', href: '/hr/users', keywords: ['staff', 'employees', 'people'] },
      { label: 'Attendance', href: '/hr/attendance', keywords: ['clock in', 'shifts'] },
    ],
  },
];

const labels = (q: string) =>
  searchRoutes(groups, q).map((h) => (h.tabLabel ? `${h.item.label} › ${h.tabLabel}` : h.item.label));

describe('searchRoutes', () => {
  it('finds a page by a domain synonym it does not display', () => {
    expect(labels('staff')).toContain('Users');
    expect(labels('employees')).toContain('Users');
  });

  it('finds a tab by a synonym of the tab', () => {
    expect(labels('salary')).toContain('Finance › Payroll');
  });

  it('survives a typo', () => {
    expect(labels('remitance')).toContain('Finance › Cash remittance');
    expect(labels('atendance')).toContain('Attendance');
  });

  it('matches by acronym', () => {
    expect(labels('cr')).toContain('Finance › Cash remittance');
  });

  it('finds a page by a word only present in its URL', () => {
    // "sales" appears nowhere in the label, group or keywords.
    expect(labels('sales')).toContain('Funnel Orders');
  });

  it('ranks a label hit above a URL-only hit', () => {
    const r = searchRoutes(groups, 'orders');
    expect(r[0]!.item.label).toBe('Funnel Orders');
  });

  it('narrows on a multi-word query, in any order', () => {
    expect(labels('funnel orders')).toEqual(['Funnel Orders']);
    expect(labels('orders funnel')).toEqual(['Funnel Orders']);
  });

  it('deep-links a tab hit to ?tab=', () => {
    const r = searchRoutes(groups, 'remitance');
    expect(r[0]!.item.href).toBe('/admin/finance?tab=remittance');
  });

  it('does not expand a page into its tabs when the page label itself matches', () => {
    const r = searchRoutes(groups, 'finance');
    expect(r.filter((h) => h.tabLabel)).toHaveLength(0);
  });

  it('keeps every page in a group matched by group name', () => {
    expect(labels('hr')).toEqual(expect.arrayContaining(['Users', 'Attendance']));
  });

  it('honours the limit option', () => {
    expect(searchRoutes(groups, 'a', { limit: 2 })).toHaveLength(2);
  });

  it('returns nothing for an empty query or a miss', () => {
    expect(searchRoutes(groups, '   ')).toEqual([]);
    expect(searchRoutes(groups, 'zzzzzz')).toEqual([]);
  });
});

describe('personContextRoutes', () => {
  const allNav = new Set([
    '/hr/users',
    '/hr/attendance',
    '/admin/marketing/orders',
    '/admin/marketing/team',
    '/admin/sales/orders',
    '/admin/sales/team',
  ]);
  const person = { id: 'u-1', name: 'Olasukanmi Ade', role: 'MEDIA_BUYER' };

  it('puts the person id straight into the URL', () => {
    const hits = personContextRoutes(person, allNav);
    expect(hits.map((h) => h.href)).toContain('/hr/users/u-1');
    expect(hits.map((h) => h.href)).toContain('/hr/attendance/u-1');
  });

  it('offers role-appropriate work pages only', () => {
    const hrefs = personContextRoutes(person, allNav).map((h) => h.href);
    expect(hrefs).toContain('/admin/marketing/orders?mediaBuyerId=u-1');
    // A media buyer has no CS pipeline.
    expect(hrefs.some((h) => h.startsWith('/admin/sales/orders'))).toBe(false);
  });

  it('filters team pages by name, since those pages take a free-text q', () => {
    const hit = personContextRoutes(person, allNav).find((h) =>
      h.href.startsWith('/admin/marketing/team'),
    );
    expect(hit!.href).toBe('/admin/marketing/team?q=Olasukanmi%20Ade');
  });

  // The permission guarantee: suggestions can never widen access.
  it('drops any suggestion whose page is not in the caller’s nav', () => {
    const hrOnly = new Set(['/hr/users']);
    const hits = personContextRoutes(person, hrOnly);
    expect(hits.map((h) => h.href)).toEqual(['/hr/users/u-1']);
  });

  // `/hr/users/:id/history` is the PAYROLL history page (payouts, salary
  // adjustments, tax documents), so seeing `/hr/users` — reachable with
  // `users.read` alone — must not offer a colleague's salary record.
  it('gates payroll history on the payroll nav item, not on users', () => {
    expect(
      personContextRoutes(person, new Set(['/hr/users'])).map((h) => h.href),
    ).not.toContain('/hr/users/u-1/history');

    const withPayroll = personContextRoutes(person, new Set(['/hr/users', '/hr/payroll']));
    expect(withPayroll.map((h) => h.href)).toContain('/hr/users/u-1/history');
    expect(withPayroll.find((h) => h.href.endsWith('/history'))!.label).toBe(
      'Olasukanmi Ade: payroll history',
    );
  });

  it('returns nothing when the caller has none of these pages', () => {
    expect(personContextRoutes(person, new Set())).toEqual([]);
  });

  it('labels each suggestion with the person’s name', () => {
    expect(personContextRoutes(person, allNav)[0]!.label).toBe('Olasukanmi Ade: profile');
  });

  it('falls back to a placeholder rather than an empty label', () => {
    const hits = personContextRoutes({ id: 'u-2', name: '  ', role: null }, allNav);
    expect(hits[0]!.label).toBe('This user: profile');
  });
});
