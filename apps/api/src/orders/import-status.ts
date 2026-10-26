/**
 * Status an imported order is written with. A row that names a CS closer is
 * already assigned, so UNPROCESSED becomes CS_ASSIGNED (the next lifecycle
 * step). Left at UNPROCESSED, the order counted as "Assigned" on the closer's
 * dashboard but never showed in their Assigned list (2B21 #109915-#109918).
 */
export function importStatusForAssignee<S extends string>(targetStatus: S, assignedCsId: string | null | undefined): S | 'CS_ASSIGNED' {
  return targetStatus === 'UNPROCESSED' && assignedCsId ? 'CS_ASSIGNED' : targetStatus;
}
