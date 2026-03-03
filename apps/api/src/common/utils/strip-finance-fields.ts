/**
 * Column-Level Security — Finance Field Stripping
 *
 * Recursively strips sensitive financial fields from any data structure
 * unless the user has SUPER_ADMIN or FINANCE_OFFICER role.
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
 * SuperAdmin bypasses. Others need finance.costView permission.
 * REST endpoints may not have permissions populated — fall back to role check.
 */
export function hasFinanceAccess(user: { role: string; permissions?: string[] }): boolean {
  if (user.role === 'SUPER_ADMIN') return true;
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
