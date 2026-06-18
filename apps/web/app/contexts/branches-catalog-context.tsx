import { createContext, useContext, type ReactNode } from 'react';

export type BranchCatalogEntry = { id: string; name: string; code: string; groupId?: string | null };

export type BranchGroupCatalogEntry = { id: string; name: string; status?: string };

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
