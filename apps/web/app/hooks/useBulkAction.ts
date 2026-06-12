import { useCallback, useRef, useState } from 'react';
import { useRevalidator } from '@remix-run/react';
import type { BulkProgressState } from '~/components/ui/bulk-progress-modal';
import { BULK_PROGRESS_IDLE } from '~/components/ui/bulk-progress-modal';

/**
 * Concurrency limit for parallel requests within a bulk action.
 * Keeps the server from being overwhelmed while still being faster than serial.
 */
const CONCURRENCY = 5;

export interface UseBulkActionReturn {
  progress: BulkProgressState;
  /** Kick off the bulk action. Resolves when all items have been processed. */
  run: (params: {
    label: string;
    items: string[];
    /** Called for each item — should return true on success, false on failure. */
    processFn: (id: string) => Promise<boolean>;
  }) => Promise<void>;
  /** Reset progress to idle (e.g. after the user clicks "Done"). Also revalidates the route. */
  reset: () => void;
  /** True while the bulk action is in flight. */
  isRunning: boolean;
}

/**
 * Generic hook that drives a `<BulkProgressModal>` for any bulk action.
 *
 * Example:
 * ```ts
 * const bulk = useBulkAction();
 * // later:
 * await bulk.run({
 *   label: 'Moving orders',
 *   items: [...selectedIds],
 *   processFn: async (orderId) => {
 *     const res = await fetch(`/trpc/orders.transferFollowUpOrder`, { method: 'POST', body: ... });
 *     return res.ok;
 *   },
 * });
 * ```
 */
export function useBulkAction(): UseBulkActionReturn {
  const [progress, setProgress] = useState<BulkProgressState>(BULK_PROGRESS_IDLE);
  const rev = useRevalidator();
  const abortRef = useRef(false);

  const run = useCallback(async ({ label, items, processFn }: {
    label: string;
    items: string[];
    processFn: (id: string) => Promise<boolean>;
  }) => {
    abortRef.current = false;
    const total = items.length;
    let completed = 0;
    let failed = 0;
    const errors: string[] = [];

    setProgress({ label, total, completed: 0, failed: 0, status: 'running' });

    // Process in batches of CONCURRENCY
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      if (abortRef.current) break;
      const batch = items.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (id) => {
          try {
            const ok = await processFn(id);
            if (!ok) throw new Error(`Failed for ${id}`);
            return true;
          } catch (err) {
            throw err;
          }
        }),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          completed++;
        } else {
          failed++;
          errors.push(r.reason?.message ?? 'Unknown error');
        }
      }
      setProgress({ label, total, completed, failed, status: 'running', errors });
    }

    setProgress({
      label,
      total,
      completed,
      failed,
      status: failed === total ? 'error' : 'complete',
      errors: errors.length > 0 ? errors : undefined,
    });
  }, []);

  const reset = useCallback(() => {
    abortRef.current = true;
    setProgress(BULK_PROGRESS_IDLE);
    rev.revalidate();
  }, [rev]);

  return {
    progress,
    run,
    reset,
    isRunning: progress.status === 'running',
  };
}
