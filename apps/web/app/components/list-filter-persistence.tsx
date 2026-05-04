import { useListFilterUserId } from '~/hooks/use-list-filter-user-id';
import { usePersistListFilters } from '~/hooks/use-persist-list-filters';

export type ListFilterPersistenceProps = {
  scope: string;
  allowlist: readonly string[];
};

/** Renders nothing; restores allowlisted URL params from localStorage and snapshots changes when idle. */
export function ListFilterPersistence({ scope, allowlist }: ListFilterPersistenceProps) {
  const userId = useListFilterUserId();
  usePersistListFilters({ scope, userId, allowlist });
  return null;
}
