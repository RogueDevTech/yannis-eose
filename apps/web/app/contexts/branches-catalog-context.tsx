import { createContext, useContext, type ReactNode } from 'react';

export type BranchCatalogEntry = { id: string; name: string; code: string };

const BranchesCatalogContext = createContext<BranchCatalogEntry[]>([]);

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

export function useBranchesCatalog(): BranchCatalogEntry[] {
  return useContext(BranchesCatalogContext);
}
