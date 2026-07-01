/**
 * Page Registry — static definition of all filterable admin pages.
 * Used by the Filter Preferences settings page to render a page tree
 * and by the frontend hook to validate page keys.
 *
 * Convention: `key` uses the Remix dot-separated route convention.
 * Pages without `parentKey` are top-level groups (containers only).
 * Leaf pages with `permissionCode` are filtered by user permissions.
 */

export interface PageRegistryEntry {
  /** Dot-separated page key, e.g. 'admin.marketing.orders'. */
  key: string;
  /** Human-readable label. */
  label: string;
  /** Parent group key for tree nesting. */
  parentKey?: string;
  /** Permission code required to access this page. SuperAdmin/Support bypass. */
  permissionCode?: string;
  /** If set, only these roles can see this page (checked alongside permissionCode). */
  roles?: string[];
}

export const PAGE_REGISTRY: ReadonlyArray<PageRegistryEntry> = [
  // ── Top-level groups (containers) ─────────────────────────────────
  { key: 'admin.sales', label: 'Sales' },
  { key: 'admin.cs', label: 'Customer Service' },
  { key: 'admin.marketing', label: 'Marketing' },
  { key: 'admin.finance', label: 'Finance' },
  { key: 'admin.logistics', label: 'Logistics' },
  { key: 'admin.inventory', label: 'Inventory' },
  { key: 'admin.hr', label: 'HR & Payroll' },
  { key: 'admin.analytics', label: 'Analytics' },

  // ── Sales ─────────────────────────────────────────────────────────
  { key: 'admin.sales.orders', label: 'Orders', parentKey: 'admin.sales', permissionCode: 'orders.read' },
  { key: 'admin.sales.cart-orders', label: 'Cart Orders', parentKey: 'admin.sales', permissionCode: 'orders.read' },
  { key: 'admin.sales.queue', label: 'CS Queue', parentKey: 'admin.sales', permissionCode: 'orders.read' },
  { key: 'admin.sales.team', label: 'Team', parentKey: 'admin.sales', permissionCode: 'cs.scope.global' },
  { key: 'admin.sales.leaderboard', label: 'Leaderboard', parentKey: 'admin.sales', permissionCode: 'cs.leaderboard' },

  // ── Customer Service ──────────────────────────────────────────────
  { key: 'admin.cs.index', label: 'CS Dashboard', parentKey: 'admin.cs', permissionCode: 'orders.read' },
  { key: 'admin.cs.follow-up', label: 'Follow-Up Orders', parentKey: 'admin.cs', permissionCode: 'orders.read' },

  // ── Marketing ─────────────────────────────────────────────────────
  { key: 'admin.marketing.orders', label: 'Orders', parentKey: 'admin.marketing', permissionCode: 'marketing.orders' },
  { key: 'admin.marketing.overview', label: 'Overview', parentKey: 'admin.marketing', permissionCode: 'marketing.overview' },
  { key: 'admin.marketing.team', label: 'Team Analysis', parentKey: 'admin.marketing', permissionCode: 'marketing.team' },
  { key: 'admin.marketing.expenses', label: 'Ad Spend', parentKey: 'admin.marketing', permissionCode: 'marketing.adSpend' },
  { key: 'admin.marketing.funding', label: 'Funding', parentKey: 'admin.marketing', permissionCode: 'marketing.funding' },
  { key: 'admin.marketing.funding.ledger', label: 'Funding Ledger', parentKey: 'admin.marketing', permissionCode: 'marketing.funding' },
  { key: 'admin.marketing.leaderboard', label: 'Leaderboard', parentKey: 'admin.marketing', permissionCode: 'marketing.leaderboard' },
  { key: 'admin.marketing.cross-funnel', label: 'Cross-Funnel', parentKey: 'admin.marketing', permissionCode: 'marketing.orders' },
  { key: 'admin.marketing.forms', label: 'Forms', parentKey: 'admin.marketing', permissionCode: 'marketing.campaigns.manage' },
  { key: 'admin.marketing.offers', label: 'Offers', parentKey: 'admin.marketing', permissionCode: 'marketing.campaigns.manage' },

  // ── Finance ───────────────────────────────────────────────────────
  { key: 'admin.finance.delivery-remittances', label: 'Cash Remittances', parentKey: 'admin.finance', permissionCode: 'finance.read' },
  { key: 'admin.finance.overview', label: 'Finance Overview', parentKey: 'admin.finance', permissionCode: 'finance.read' },
  { key: 'admin.finance.payout', label: 'Payouts', parentKey: 'admin.finance', permissionCode: 'finance.read' },
  { key: 'admin.finance.profit-by-shipment', label: 'Profit by Shipment', parentKey: 'admin.finance', permissionCode: 'finance.read' },
  { key: 'admin.finance.staff-accounts', label: 'Staff Accounts', parentKey: 'admin.finance', permissionCode: 'finance.read' },
  { key: 'admin.finance.disbursements', label: 'Disbursements', parentKey: 'admin.finance', permissionCode: 'finance.read' },

  // ── Logistics ─────────────────────────────────────────────────────
  { key: 'admin.logistics.orders', label: 'Logistics Orders', parentKey: 'admin.logistics', permissionCode: 'logistics.read' },
  { key: 'admin.logistics.partners', label: 'Partners', parentKey: 'admin.logistics', permissionCode: 'logistics.providers.view' },
  { key: 'admin.logistics.remittances', label: 'Remittances', parentKey: 'admin.logistics', permissionCode: 'logistics.read' },
  { key: 'admin.logistics.transfers', label: 'Transfers', parentKey: 'admin.logistics', permissionCode: 'logistics.partner_transfers.view' },
  { key: 'admin.logistics.team', label: 'Team', parentKey: 'admin.logistics', permissionCode: 'logistics.scope.global' },

  // ── Inventory ─────────────────────────────────────────────────────
  { key: 'admin.inventory.index', label: 'Stock', parentKey: 'admin.inventory', permissionCode: 'inventory.read' },
  { key: 'admin.inventory.shipments', label: 'Shipments', parentKey: 'admin.inventory', permissionCode: 'inventory.read' },
  { key: 'admin.inventory.warehouses', label: 'Warehouses', parentKey: 'admin.inventory', permissionCode: 'inventory.read' },

  // ── HR ────────────────────────────────────────────────────────────
  { key: 'admin.orders.index', label: 'All Orders', parentKey: 'admin.hr', permissionCode: 'orders.read' },

  // ── Analytics ─────────────────────────────────────────────────────
  { key: 'admin.analytics.audit', label: 'Audit Log', parentKey: 'admin.analytics', permissionCode: 'audit.read' },
  { key: 'admin.audit', label: 'Audit Trail', parentKey: 'admin.analytics', permissionCode: 'audit.read' },

  // ── Top-level pages ───────────────────────────────────────────────
  { key: 'admin.products', label: 'Products' },
  { key: 'admin.returns', label: 'Returns', permissionCode: 'orders.read' },
  { key: 'admin.permission-requests', label: 'Permission Requests' },
  { key: 'admin.notifications', label: 'Notifications' },
];

// ── Tree builder ──────────────────────────────────────────────────────

export interface PageTreeNode extends PageRegistryEntry {
  children: PageTreeNode[];
}

export function buildPageTree(entries: ReadonlyArray<PageRegistryEntry>): PageTreeNode[] {
  const map = new Map<string, PageTreeNode>();
  const roots: PageTreeNode[] = [];

  for (const entry of entries) {
    map.set(entry.key, { ...entry, children: [] });
  }
  for (const node of map.values()) {
    if (node.parentKey && map.has(node.parentKey)) {
      map.get(node.parentKey)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** Filter tree by user permissions. SuperAdmin/Support see all. */
export function filterPageTreeByPermissions(
  tree: PageTreeNode[],
  userPermissions: string[],
  userRole: string,
): PageTreeNode[] {
  const bypass = userRole === 'SUPER_ADMIN' || userRole === 'SUPPORT' || userRole === 'ADMIN';
  const permSet = new Set(userPermissions);

  function filter(nodes: PageTreeNode[]): PageTreeNode[] {
    return nodes
      .map((node) => {
        const children = filter(node.children);
        const hasAccess =
          bypass ||
          !node.permissionCode ||
          permSet.has(node.permissionCode) ||
          (node.roles && node.roles.some((r) => r === userRole));
        if (!hasAccess && children.length === 0) return null;
        return { ...node, children };
      })
      .filter((n): n is PageTreeNode => n !== null);
  }
  return filter(tree);
}

/** Flat set of all valid page keys for validation. */
export const VALID_PAGE_KEYS = new Set(PAGE_REGISTRY.map((p) => p.key));
