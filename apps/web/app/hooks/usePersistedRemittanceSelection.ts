import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Persist the in-progress Cash Remittance batch to localStorage so a finance
 * user can check a batch of orders, navigate away to verify something, and
 * return to find their selection AND any batch details (delivery fees, extra
 * costs, note) intact instead of starting from scratch.
 *
 * The persisted "selection" (order IDs + full row data) IS the ongoing batch:
 * checking more rows on the list page grows the same batch. The batch-detail
 * draft (fees/costs/note entered on the create page) is stored alongside so the
 * create page can restore it when the user returns to continue.
 *
 * Two consumers share this store:
 *  - the list page reads/writes the selection (checkboxes) + shows the banner
 *  - the create page reads/writes the batch-detail draft
 *
 * SSR-safe: never touches localStorage during render. Initial state is empty on
 * the server and hydrates from storage in a mount effect, matching the pattern
 * in `usePersistedFilters`.
 */
export const REMITTANCE_BATCH_STORAGE_KEY = 'yannis:remittance-batch';
/**
 * The create-page batch DRAFT (per-order delivery fees, extra costs, note,
 * toggle) lives under its own key so nothing on the list page can wipe it. It is
 * tagged with the batch's order IDs: the draft is restored when the current
 * batch is the same batch, a grown version of it (more orders checked on the
 * list page), or a shrunk version (orders removed). An unrelated batch starts
 * clean.
 */
const REMITTANCE_DRAFT_STORAGE_KEY = 'yannis:remittance-draft';

/** Batch-level detail entered on the create page (all optional / free-form strings). */
export type RemittanceBatchDraft = {
  deliveryFees: Record<string, string>;
  commitmentFee: string;
  posFee: string;
  failedDeliveryCost: string;
  discount: string;
  waybillCost: string;
  batchNote: string;
  markReceivedNow: boolean;
};

export const EMPTY_BATCH_DRAFT: RemittanceBatchDraft = {
  deliveryFees: {},
  commitmentFee: '',
  posFee: '',
  failedDeliveryCost: '',
  discount: '',
  waybillCost: '',
  batchNote: '',
  markReceivedNow: true,
};

type PersistedShape<T> = {
  ids: string[];
  rows: Array<[string, T]>;
};

function readStore<T>(): PersistedShape<T> | null {
  try {
    const stored = localStorage.getItem(REMITTANCE_BATCH_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as PersistedShape<T>;
    if (parsed && Array.isArray(parsed.ids) && Array.isArray(parsed.rows)) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * List-page hook: owns the selected order IDs + row data (the batch membership).
 * Reads/writes the shared batch store, preserving any batch-detail draft written
 * by the create page.
 */
export function usePersistedRemittanceSelection<T>() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedById, setSelectedById] = useState<Map<string, T>>(() => new Map());

  // Skip the first persist write so the empty initial state doesn't clobber
  // stored selection before the hydrate effect has run.
  const hydratedRef = useRef(false);

  useEffect(() => {
    const parsed = readStore<T>();
    if (parsed) {
      setSelectedIds(new Set(parsed.ids));
      setSelectedById(new Map(parsed.rows));
    }
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      if (selectedIds.size === 0) {
        localStorage.removeItem(REMITTANCE_BATCH_STORAGE_KEY);
        return;
      }
      const payload: PersistedShape<T> = {
        ids: [...selectedIds],
        rows: [...selectedById.entries()],
      };
      localStorage.setItem(REMITTANCE_BATCH_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Quota / disabled storage — selection still works in-memory.
    }
  }, [selectedIds, selectedById]);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedById(new Map());
    try {
      localStorage.removeItem(REMITTANCE_BATCH_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { selectedIds, setSelectedIds, selectedById, setSelectedById, clear } as const;
}

/**
 * Lightweight reader for the ongoing-batch banner on the list page. Returns how
 * many orders are in the persisted batch and re-checks on `focus` / storage
 * changes so the banner stays in sync across tabs. Does not own the selection.
 */
export function useRemittanceBatchDraftCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const refresh = () => setCount(readStore()?.ids.length ?? 0);
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return count;
}

type StoredDraft = {
  ids?: string[];
  /** Legacy tag from the first release: sorted order IDs joined by ','. */
  sig?: string;
  draft: RemittanceBatchDraft;
};

/** True when one of the two ID sets contains the other (same batch, grown, or shrunk). */
function isSameOngoingBatch(storedIds: string[], currentIds: string[]): boolean {
  if (storedIds.length === 0 || currentIds.length === 0) return false;
  const stored = new Set(storedIds);
  const current = new Set(currentIds);
  return (
    [...stored].every((id) => current.has(id)) || [...current].every((id) => stored.has(id))
  );
}

/**
 * Read the persisted batch-detail draft for the given batch. Returns an empty
 * draft when nothing is saved, or when the saved draft belongs to an UNRELATED
 * batch so it never inherits stale fees. A batch that merely grew (more orders
 * checked on the list page) or shrank (orders removed) is still the same
 * ongoing batch and keeps its draft.
 */
export function readRemittanceBatchDraft(currentOrderIds: string[]): RemittanceBatchDraft {
  try {
    const raw = localStorage.getItem(REMITTANCE_DRAFT_STORAGE_KEY);
    if (!raw) return { ...EMPTY_BATCH_DRAFT };
    const parsed = JSON.parse(raw) as StoredDraft;
    if (!parsed?.draft) return { ...EMPTY_BATCH_DRAFT };
    const storedIds = parsed.ids ?? parsed.sig?.split(',').filter(Boolean) ?? [];
    if (!isSameOngoingBatch(storedIds, currentOrderIds)) return { ...EMPTY_BATCH_DRAFT };
    const draft = { ...EMPTY_BATCH_DRAFT, ...parsed.draft };
    // Drop fees for orders no longer in the batch (shrunk elsewhere or ineligible).
    const current = new Set(currentOrderIds);
    draft.deliveryFees = Object.fromEntries(
      Object.entries(draft.deliveryFees ?? {}).filter(([id]) => current.has(id)),
    );
    return draft;
  } catch {
    return { ...EMPTY_BATCH_DRAFT };
  }
}

/**
 * Persist the create-page batch draft under its own key, tagged with the batch's
 * order IDs. Independent of the list-page selection store so navigating back to
 * the list can never wipe it.
 */
export function writeRemittanceBatchDraft(
  draft: RemittanceBatchDraft,
  currentOrderIds: string[],
): void {
  try {
    if (currentOrderIds.length === 0) return;
    const payload: StoredDraft = { ids: [...currentOrderIds], draft };
    localStorage.setItem(REMITTANCE_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/**
 * Drop one order from the persisted batch. Keeps the list-page selection store
 * in sync AND migrates the create-page draft to the new (smaller) batch so the
 * fees/costs already entered for the remaining orders survive the removal.
 * `remainingOrderIds` is the batch after removal (as the create page sees it).
 */
export function removeOrderFromRemittanceBatch(
  orderId: string,
  remainingOrderIds: string[],
): void {
  // 1. Keep the list-page selection store aligned (best-effort).
  try {
    const existing = readStore<unknown>();
    if (existing) {
      const ids = existing.ids.filter((id) => id !== orderId);
      if (ids.length === 0) {
        localStorage.removeItem(REMITTANCE_BATCH_STORAGE_KEY);
      } else {
        const rows = existing.rows.filter(([id]) => id !== orderId);
        localStorage.setItem(REMITTANCE_BATCH_STORAGE_KEY, JSON.stringify({ ids, rows }));
      }
    }
  } catch {
    /* ignore */
  }

  // 2. Migrate the standalone draft: drop the removed order's fee and re-key to
  //    the remaining batch so it still loads when the create page re-mounts.
  try {
    if (remainingOrderIds.length === 0) {
      localStorage.removeItem(REMITTANCE_DRAFT_STORAGE_KEY);
      return;
    }
    const raw = localStorage.getItem(REMITTANCE_DRAFT_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as StoredDraft;
    const draft = parsed?.draft ?? { ...EMPTY_BATCH_DRAFT };
    if (draft.deliveryFees && orderId in draft.deliveryFees) {
      const restFees = { ...draft.deliveryFees };
      delete restFees[orderId];
      draft.deliveryFees = restFees;
    }
    const payload: StoredDraft = { ids: [...remainingOrderIds], draft };
    localStorage.setItem(REMITTANCE_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/** Wipe the entire ongoing batch: list selection AND the create-page draft. */
export function clearRemittanceBatch(): void {
  try {
    localStorage.removeItem(REMITTANCE_BATCH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(REMITTANCE_DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
