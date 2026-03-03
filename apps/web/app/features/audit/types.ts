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
  page: number;
  limit: number;
}

export interface AuditPageProps {
  rows: AuditEntry[];
  total: number;
  filters: AuditFilters;
  actorNames: Promise<Record<string, { name: string; role: string }>>;
  error?: string;
}

/** Streaming-aware loader shape for the audit route */
export interface AuditStreamData {
  rows: AuditEntry[];
  total: number;
  filters: AuditFilters;
  actorNames: Promise<Record<string, { name: string; role: string }>>;
  error?: string;
}
