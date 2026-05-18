/**
 * Max `limit` values for tRPC list inputs — MUST stay aligned with packages/shared validators.
 * Passing a higher limit causes Zod validation failure and yields empty lists in UI loaders.
 */

/** Align with `users.list` / `packages/shared/src/validators/users.ts`. */
export const USERS_LIST_MAX_LIMIT = 100 as const;

/** Align with `products.list` / `packages/shared/src/validators/products.ts`. */
export const PRODUCTS_LIST_MAX_LIMIT = 100 as const;
