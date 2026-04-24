import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';

type Drizzle = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Drizzle['transaction']>[0]>[0];

/**
 * Wrap a block of DB writes in a transaction with `yannis.current_user_id` set to the
 * authenticated actor. The PostgreSQL temporal-audit trigger reads this session variable per
 * statement to record who performed each mutation (column `modified_by` → "Changed By" in the
 * audit UI).
 *
 * Why this helper exists:
 *   - postgres.js pools connections (default max: 5).
 *   - Running `pgClient`SELECT set_config('yannis.current_user_id', x, true)`` on a bare query
 *     sets the value for a *single auto-commit transaction* — the setting dies the moment that
 *     SELECT completes. The next `db.insert(...)` lands on a different pooled connection where
 *     the setting is empty, the trigger records NULL, and the audit UI shows "System".
 *   - `set_config(var, value, is_local=true)` is transaction-scoped; wrapping the writes in
 *     drizzle's `db.transaction()` pins a single connection + runs set_config as the first
 *     statement, so every subsequent write inside the block sees the actor.
 *   - Note: `SET LOCAL var = $1` does NOT work — postgres rejects parameters in SET with
 *     "syntax error at or near $1". Use `set_config(var, $1, true)` instead, since function
 *     arguments accept parameters.
 *
 * Every write path that ultimately inserts/updates a row with `modified_by` MUST go through
 * `withActor()` — otherwise its audit entries silently attribute to "System". See
 * `CLAUDE.md` → "Database Principles" → "The Actor Injection Pattern".
 *
 * Usage:
 * ```ts
 * return withActor(this.db, actor, async (tx) => {
 *   await tx.insert(schema.orders).values({ ... });
 *   await tx.update(schema.users).set({ ... });
 *   return something;
 * });
 * ```
 */
export async function withActor<T>(
  db: Drizzle,
  actor: { id: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`);
    return fn(tx);
  });
}

/**
 * Same as {@link withActor} but also sets the branch context (`yannis.current_branch_id`).
 * Use when the operation writes to branch-scoped tables — RLS policies filter on this variable
 * and will reject writes if it's missing on branch-scoped tables.
 */
export async function withActorAndBranch<T>(
  db: Drizzle,
  actor: { id: string; currentBranchId?: string | null },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`);
    if (actor.currentBranchId) {
      await tx.execute(sql`SELECT set_config('yannis.current_branch_id', ${actor.currentBranchId}, true)`);
    }
    return fn(tx);
  });
}
