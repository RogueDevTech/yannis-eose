import { createContext, useContext, useMemo, type ReactNode } from 'react';

export type BranchCatalogEntry = { id: string; name: string; code: string; groupId?: string | null };

export type BranchGroupCatalogEntry = {
  id: string;
  name: string;
  status?: string;
  /** Company order-label prefix (branch_groups.order_prefix, migration 0343). */
  orderPrefix?: string | null;
};

const BranchesCatalogContext = createContext<BranchCatalogEntry[]>([]);
const BranchGroupsCatalogContext = createContext<BranchGroupCatalogEntry[]>([]);

/** Resolved branch list from `DashboardLayout` (after streaming `branches.list`). */
export function BranchesCatalogProvider({
  value,
  children,
}: {
  value: BranchCatalogEntry[];
  children: ReactNode;
}) {
  return <BranchesCatalogContext.Provider value={value}>{children}</BranchesCatalogContext.Provider>;
}

export function BranchGroupsCatalogProvider({
  value,
  children,
}: {
  value: BranchGroupCatalogEntry[];
  children: ReactNode;
}) {
  return <BranchGroupsCatalogContext.Provider value={value}>{children}</BranchGroupsCatalogContext.Provider>;
}

export function useBranchesCatalog(): BranchCatalogEntry[] {
  return useContext(BranchesCatalogContext);
}

export function useBranchGroupsCatalog(): BranchGroupCatalogEntry[] {
  return useContext(BranchGroupsCatalogContext);
}

/**
 * Resolve an order's company prefix from the branch it belongs to.
 *
 * Order labels are prefixed per company (YNS-113037 vs ZAR-113037) so the
 * owning company is visible on the reference itself. The branch → company →
 * prefix chain is already in these catalogs, so display sites can resolve it
 * without every order payload having to carry the prefix.
 *
 * Returns undefined when the branch or company is unknown, which makes
 * `formatOrderNumber` fall back to the default prefix rather than render a
 * wrong company.
 */
export function useOrderPrefix(branchId: string | null | undefined): string | undefined {
  const resolve = useOrderPrefixResolver();
  return resolve(branchId);
}

/**
 * Prefix for the only company in view.
 *
 * For rows that carry no branch of their own. Safe because the surfaces using
 * it are already scoped to one company, so every row on the page shares that
 * company's prefix. Falls back to the default when more than one company is in
 * the catalog and none is unambiguous, rather than labelling rows with a
 * company they may not belong to.
 */
export function useActiveCompanyOrderPrefix(): string | undefined {
  const groups = useBranchGroupsCatalog();
  if (groups.length !== 1) return undefined;
  return groups[0]?.orderPrefix ?? undefined;
}

/**
 * Same resolution as `useOrderPrefix`, but returns a lookup function so lists
 * can resolve a prefix per row. Hooks cannot be called inside a map, so any
 * component rendering many orders needs this form.
 */
export function useOrderPrefixResolver(): (branchId: string | null | undefined) => string | undefined {
  const branches = useBranchesCatalog();
  const groups = useBranchGroupsCatalog();
  return useMemo(() => {
    const groupOfBranch = new Map(branches.map((b) => [b.id, b.groupId ?? null]));
    const prefixOfGroup = new Map(groups.map((g) => [g.id, g.orderPrefix ?? undefined]));
    return (branchId: string | null | undefined) => {
      if (!branchId) return undefined;
      const groupId = groupOfBranch.get(branchId);
      if (!groupId) return undefined;
      return prefixOfGroup.get(groupId);
    };
  }, [branches, groups]);
}
