/**
 * Column-Level Security — Finance Field Stripping
 *
 * Recursively strips sensitive financial fields from any data structure
 * unless the user is explicitly authorized (see `hasFinanceAccess`).
 *
 * PRD Ref: Section 11.3 (Column-Level Security)
 * Fields protected: costPrice, landed_cost, margin, factoryCost,
 * landingCost, totalLandedCost, internalFulfillmentCost
 */

/** Field names (camelCase and snake_case) to strip from responses */
const SENSITIVE_FIELDS = new Set([
  // Product cost fields
  'costPrice',
  'cost_price',
  // Batch / inventory cost fields
  'factoryCost',
  'factory_cost',
  'landingCost',
  'landing_cost',
  'totalLandedCost',
  'total_landed_cost',
  // Order cost fields
  'landedCost',
  'landed_cost',
  // Calculated fields
  'margin',
  // Fulfillment cost
  'internalFulfillmentCost',
  'internal_fulfillment_cost',
]);

/**
 * Check if user has access to financial fields.
 * SUPER_ADMIN bypasses. Others qualify via:
 *   - `finance.costView` permission
 *   - `FINANCE_OFFICER` primary role
 *   - the "Finance hat" flag (`isFinanceOfficer`) — lets any user carry finance powers on top of
 *     their primary role; exactly one user wears it at a time. See migration 0059.
 * REST endpoints may not have permissions populated — fall back to role/flag check.
 */
export function hasFinanceAccess(user: { role: string; permissions?: string[]; isFinanceOfficer?: boolean }): boolean {
  if (user.permissions?.includes('finance.costView')) return true;
  if (user.role === 'FINANCE_OFFICER') return true;
  if (user.isFinanceOfficer === true) return true;
  return false;
}

/**
 * Recursively strip sensitive financial fields from a value.
 * - Objects: nullifies matching keys, recurses into non-matching values
 * - Arrays: recurses into each element
 * - Primitives: returned as-is
 */
export function stripFinanceFields<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => stripFinanceFields(item)) as T;
  }

  if (typeof data === 'object' && !(data instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_FIELDS.has(key)) {
        result[key] = null;
      } else {
        result[key] = stripFinanceFields(value);
      }
    }
    return result as T;
  }

  return data;
}
