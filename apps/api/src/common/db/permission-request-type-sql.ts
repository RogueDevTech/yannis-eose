import { sql, type SQL } from 'drizzle-orm';

/**
 * Compare `permission_requests.type` without coercing the bound parameter to Postgres
 * `permission_request_type`. Unknown labels throw until `ALTER TYPE ... ADD VALUE` runs;
 * casting the column to text avoids that on SELECT paths.
 */
export function permissionRequestTypeTextEq(column: unknown, label: string): SQL {
  return sql`(${column})::text = ${label}`;
}
