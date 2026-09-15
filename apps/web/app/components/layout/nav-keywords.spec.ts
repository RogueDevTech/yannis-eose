/**
 * Guards the KEYWORDS on the real nav tree in `dashboard-layout.tsx`.
 *
 * The scoring engine is unit-tested in `~/lib/smart-search.spec.ts`; this file
 * tests the vocabulary — that the words people actually type reach the page
 * they mean, against the real nav structure rather than a fixture. It is the
 * test that fails if someone deletes a keyword list or renames a page without
 * moving its synonyms.
 *
 * The nav tree is parsed out of the source rather than imported because
 * `dashboard-layout.tsx` pulls in Remix, React context and icon JSX; parsing
 * keeps this a fast pure test. Only label/href/keywords/tabs are read, which
 * is exactly what the search engine consumes.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { searchRoutes, type RouteSearchGroup } from '~/lib/route-search';

function parseNavStructure(): Array<RouteSearchGroup> {
  const src = readFileSync('app/components/layout/dashboard-layout.tsx', 'utf8');
  const start = src.indexOf('const navStructure: NavGroupDef[] = [');
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('\n];', start));

  const groups: Array<RouteSearchGroup> = [];
  for (const block of body.split(/\n  \{\n/).slice(1)) {
    const gm = block.match(/group: (?:null|'([^']*)')/);
    const items: RouteSearchGroup['items'] = [];
    for (const chunk of block.split(/\n      \{\n/).slice(1)) {
      const label = chunk.match(/label: '([^']*)'/)?.[1];
      const href = chunk.match(/href: '([^']*)'/)?.[1];
      if (!label || !href) continue;
      const kwRaw = chunk.match(/keywords: \[([^\]]*)\]/)?.[1];
      const tabsRaw = chunk.match(/tabs: \[([\s\S]*?)\n        \]/)?.[1];
      items.push({
        label,
        href,
        ...(kwRaw
          ? {
              keywords: kwRaw
                .split(',')
                .map((x) => x.trim().replace(/^'|'$/g, ''))
                .filter(Boolean),
            }
          : {}),
        ...(tabsRaw
          ? {
              tabs: [
                ...tabsRaw.matchAll(
                  /\{ value: '([^']*)', label: '([^']*)'(?:, param: '([^']*)')?/g,
                ),
              ].map((m) => ({
                value: m[1]!,
                label: m[2]!,
                ...(m[3] ? { param: m[3] } : {}),
              })),
            }
          : {}),
      });
    }
    if (items.length) groups.push({ group: gm ? (gm[1] ?? null) : null, items });
  }
  return groups;
}

const nav = parseNavStructure();

/** The label (or "Page›Tab") of the best hit for `q`. */
function topHit(q: string): string | null {
  const [hit] = searchRoutes(nav, q, { limit: 1 });
  if (!hit) return null;
  return hit.tabLabel ? `${hit.item.label}›${hit.tabLabel}` : hit.item.label;
}

function hitLabels(q: string, limit = 5): string[] {
  return searchRoutes(nav, q, { limit }).map((h) =>
    h.tabLabel ? `${h.item.label}›${h.tabLabel}` : h.item.label,
  );
}

describe('nav keyword vocabulary', () => {
  it('parses the real nav tree, and every item carries keywords', () => {
    const items = nav.flatMap((g) => g.items);
    expect(items.length).toBeGreaterThan(60);
    const missing = items.filter((i) => !i.keywords?.length).map((i) => i.href);
    expect(missing).toEqual([]);
  });

  // Concept words: the user knows the domain, not our labels.
  it.each([
    ['cogs', 'Shipments'],
    ['fifo', 'Shipments'],
    ['landed cost', 'Shipments'],
    ['salary', 'Payroll'],
    ['clock in', 'Attendance'],
    ['who did this', 'Audit Trail'],
    ['vat', 'Tax Returns'],
    ['approvals', 'Permission Requests'],
    ['download csv', 'Export'],
    ['sku', 'Products'],
    ['3pl', 'Logistics companies'],
    ['pnl', 'Profit & Loss'],
    ['walk in', 'Offline Orders'],
    ['duplicate leads', 'Cross-funnel'],
    ['my password', 'My Profile'],
  ])('"%s" reaches %s', (query, expected) => {
    expect(hitLabels(query)).toContain(expected);
  });

  // Typos: the engine, exercised against real labels.
  it.each([
    ['remitance', 'Cash remittance'],
    ['atendance', 'Attendance'],
    ['payrol', 'Payroll'],
    ['leaderbord', 'Leaderboard'],
    ['permisions', 'Permission Requests'],
    ['inventry', 'Inventory'],
  ])('typo "%s" still reaches %s', (query, expected) => {
    expect(hitLabels(query)).toContain(expected);
  });

  it('ranks the page the user literally named first', () => {
    expect(topHit('payroll')).toBe('Payroll');
    expect(topHit('shipments')).toBe('Shipments');
    expect(topHit('attendance')).toBe('Attendance');
  });

  it('reaches a tab section inside a page', () => {
    expect(hitLabels('abandoned cart')).toContain('Live Activities›Abandoned carts');
  });

  it('finds nothing for a query that means nothing here', () => {
    expect(searchRoutes(nav, 'zzzqqq')).toEqual([]);
  });
});

/**
 * Tab deep-links must actually WORK.
 *
 * A declared tab generates `?<param>=<value>`, but nothing previously checked
 * that the target page reads that param, or that it accepts that value. Five
 * nav items shipped tab sets the page ignored entirely (local `useState`, URL
 * never read) and two used the wrong param name, so those search results
 * silently dumped the user on the page's default section.
 *
 * This test closes that gap by reading the target page's own source: for every
 * declared tab it requires a `searchParams.get('<param>')` and requires the
 * declared value to appear as a literal. It is deliberately source-grepping
 * rather than rendering — cheap, and it fails for exactly the right reason.
 */
describe('tab deep-links are consumed by their target page', () => {
  /**
   * Source files that back a nav href. A page's tab handling lives in either
   * its route module or the feature component the route renders, so both are
   * searched, following the route's imports one level into `~/features`.
   */
  function sourcesForHref(href: string): string[] {
    // `/admin/marketing/funding` → `admin.marketing.funding`
    const flat = href.replace(/^\//, '').replace(/\//g, '.');
    const dirs = [`app/routes/${flat}`, `app/routes/${flat}._index`];
    const files: string[] = [];
    for (const dir of dirs) {
      for (const candidate of [`${dir}/route.tsx`, `${dir}.tsx`]) {
        if (existsSync(candidate)) files.push(candidate);
      }
    }
    // Follow `~/features/...` and `~/lib/...` imports transitively (2 levels),
    // because a page's accepted tab values are often declared in a sibling
    // `types.ts` rather than inline — e.g. Live Activities keeps them in
    // `~/features/cs/types` as CS_QUEUE_TAB_VALUES.
    const seen = new Set(files);
    let frontier = [...files];
    for (let depth = 0; depth < 2; depth++) {
      const next: string[] = [];
      for (const f of frontier) {
        for (const m of readFileSync(f, 'utf8').matchAll(
          /from '~\/((?:features|lib|components)\/[\w./-]+)'/g,
        )) {
          for (const cand of [`app/${m[1]!}.tsx`, `app/${m[1]!}.ts`]) {
            if (existsSync(cand) && !seen.has(cand)) {
              seen.add(cand);
              next.push(cand);
            }
          }
        }
      }
      frontier = next;
    }
    return [...seen];
  }

  const tabbed = nav
    .flatMap((g) => g.items)
    .filter((i) => i.tabs?.length)
    .map((i) => ({ href: i.href, tabs: i.tabs! }));

  it('finds every tabbed page in the source tree', () => {
    expect(tabbed.length).toBeGreaterThan(0);
    for (const { href } of tabbed) {
      expect(sourcesForHref(href), `no source found for ${href}`).not.toHaveLength(0);
    }
  });

  it.each(tabbed.map((t) => [t.href, t] as const))(
    '%s reads its tab param and accepts every declared value',
    (href, entry) => {
      const src = sourcesForHref(href)
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n');

      for (const tab of entry.tabs) {
        const param = tab.param ?? 'tab';
        const read = `searchParams.get('${param}')`;

        // 1. The page must actually READ the param the deep-link sets. This is
        //    what catches a page that keeps its section in local `useState`
        //    and ignores the URL, and it is what caught five nav items whose
        //    declared tabs were dead links.
        expect(
          src.includes(read),
          `${href} declares ?${param}= but its source never reads ${read}. ` +
            `Either the page ignores the URL (drop the tabs), or the param name is wrong.`,
        ).toBe(true);

        // 2. The declared value must appear in the page's source. Pages resolve
        //    the param in varied shapes — an inline comparison, a lookup in a
        //    `*_TAB_VALUES` array, or a parse helper where the value is only a
        //    fallback `return` — so this checks presence rather than trying to
        //    prove the binding, which produced false positives on every page
        //    of the third shape.
        expect(
          src.includes(`'${tab.value}'`),
          `${href} declares ?${param}=${tab.value} but its source never mentions '${tab.value}'. ` +
            `Likely a renamed or removed section.`,
        ).toBe(true);
      }
    },
  );
});
