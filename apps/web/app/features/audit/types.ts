export interface AuditEntry {
  id: string;
  tableName: string;
  recordId: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changedBy: string | null;
  validFrom: string;
  validTo: string | null;
  data: Record<string, unknown>;
}

export interface AuditFilters {
  tableName: string;
  actorId: string;
  startDate: string;
  endDate: string;
  periodAllTime?: boolean;
  page: number;
  limit: number;
}

/**
 * One slice of a user's name+role lifetime — pulled from `users` (current) and
 * `users_history`. Used to render an actor as they appeared at the action's timestamp.
 */
export interface ActorVersion {
  /** ISO — when this version became active. */
  validFrom: string;
  /** ISO — when this version was superseded. `null` for the current version. */
  validTo: string | null;
  name: string;
  role: string;
}

export interface ActorRecord {
  /** What the actor is called right now. */
  nameNow: string;
  roleNow: string;
  /** Newest-first. Always includes the current version + every historical version. */
  history: ActorVersion[];
}

export type ActorMap = Record<string, ActorRecord>;

/** Preloaded `/admin/analytics/audit` actor filter options (SSR). */
export interface AuditActorFilterOption {
  id: string;
  name: string;
  role: string;
}

export interface AuditPageProps {
  rows: AuditEntry[];
  total: number;
  filters: AuditFilters;
  actorIds: string[];
  /** Staff shown in the “filter by actor” picker (scoped like the audit log). */
  actorFilterOptions: AuditActorFilterOption[];
  /** Logistics location display names keyed by UUID (SSR-resolved for `stock_transfers` rows). */
  locationNames: Record<string, string>;
  error?: string;
}

/** Streaming-aware loader shape for the audit route */
export interface AuditStreamData {
  rows: AuditEntry[];
  total: number;
  filters: AuditFilters;
  actorIds: string[];
  actorFilterOptions: AuditActorFilterOption[];
  locationNames: Record<string, string>;
  error?: string;
}
