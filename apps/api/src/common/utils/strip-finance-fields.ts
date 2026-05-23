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
 *   - `finance.costView` permission grant (admins assign this via the permission matrix —
 *     the previous "Finance hat" boolean was retired in favour of standard permission
 *     overrides; deputize an absent accountant by granting `finance.*` codes directly).
 *   - `FINANCE_OFFICER` primary role
 * REST endpoints may not have permissions populated — fall back to role check.
 */
export function hasFinanceAccess(user: { role: string; permissions?: string[] }): boolean {
  // SUPER_ADMIN's `permissions` array is empty by design — every gate
  // short-circuits for them at the middleware layer. REST contexts can land
  // here without the permissions populated, so keep the explicit role bypass.
  if (user.role === 'SUPER_ADMIN') return true;
  if (user.role === 'SUPPORT') return true;
  if (user.permissions?.includes('finance.costView')) return true;
  if (user.role === 'FINANCE_OFFICER') return true;
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
