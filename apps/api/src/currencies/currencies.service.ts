import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, asc, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  db as schema,
  type CreateCurrencyInput,
  type UpdateCurrencyInput,
  type SetFxRateInput,
  type SetDefaultCurrencyInput,
  type ListCurrenciesInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import { assertGroupInScope } from '../common/db/assert-entity-in-scope';

type Actor = { id: string };

/**
 * CurrenciesService — per-group ("company") currency + country config.
 *
 * The whole multi-currency feature stays DORMANT until a group has 2+ ACTIVE
 * currencies. Seeded NGN default is created in migration 0316. All ops are
 * group-scoped: SUPER_ADMIN/SUPPORT can target any group (activeGroupId null →
 * they pass a groupId); everyone else is pinned to their active group by the
 * router before it reaches here.
 *
 * FX is a REPORTING LENS ONLY — never converts operational money.
 */
@Injectable()
export class CurrenciesService {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  /** List currencies for a group (NULL group falls back to the global set). */
  async list(input: ListCurrenciesInput) {
    const groupId = input.groupId ?? null;
    const conds: SQL[] = [
      groupId == null
        ? sql`${schema.currencies.groupId} IS NULL`
        : eq(schema.currencies.groupId, groupId),
    ];
    if (input.activeOnly) conds.push(eq(schema.currencies.active, true));
    return this.db
      .select()
      .from(schema.currencies)
      .where(and(...conds))
      .orderBy(asc(schema.currencies.isDefault), asc(schema.currencies.code));
  }

  /** Active currencies only — the app-wide catalog + dormancy source. */
  async listActive(groupId: string | null) {
    return this.list({ groupId, activeOnly: true });
  }

  private async loadOrThrow(id: string) {
    const [row] = await this.db.select().from(schema.currencies).where(eq(schema.currencies.id, id)).limit(1);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Currency not found.' });
    return row;
  }

  async create(input: CreateCurrencyInput & { groupId: string | null }, actor: Actor, activeGroupId: string | null) {
    assertGroupInScope(input.groupId, activeGroupId, { message: 'Cannot add a currency outside your active company.' });
    return withActor(this.db, actor, async (tx) => {
      // Reject duplicate (group, code).
      const dup = await tx
        .select({ id: schema.currencies.id })
        .from(schema.currencies)
        .where(and(this.groupEq(input.groupId), eq(schema.currencies.code, input.code)))
        .limit(1);
      if (dup.length) {
        throw new TRPCError({ code: 'CONFLICT', message: `Currency ${input.code} already exists for this company.` });
      }

      // If this is being created as the default, demote any existing default first.
      if (input.isDefault) await this.demoteDefault(tx, input.groupId);

      const [row] = await tx
        .insert(schema.currencies)
        .values({
          groupId: input.groupId,
          code: input.code,
          symbol: input.symbol,
          countryName: input.countryName,
          precision: input.precision,
          isDefault: input.isDefault,
          active: input.active,
          fxRateToBase: input.fxRate != null ? sql`${input.fxRate}::numeric` : null,
          fxRateUpdatedAt: input.fxRate != null ? new Date() : null,
          fxRateUpdatedBy: input.fxRate != null ? actor.id : null,
        })
        .returning();
      return row!;
    });
  }

  async update(input: UpdateCurrencyInput, actor: Actor, activeGroupId: string | null) {
    const existing = await this.loadOrThrow(input.id);
    assertGroupInScope(existing.groupId, activeGroupId, { message: 'Cannot edit a currency outside your active company.' });

    // The default (base) currency is locked: its symbol/country/precision and
    // active flag cannot be edited, and the base cannot be changed.
    if (existing.isDefault) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'The default currency is locked and cannot be edited.' });
    }

    return withActor(this.db, actor, async (tx) => {
      const patch: Record<string, unknown> = {};
      if (input.symbol !== undefined) patch['symbol'] = input.symbol;
      if (input.countryName !== undefined) patch['countryName'] = input.countryName;
      if (input.precision !== undefined) patch['precision'] = input.precision;
      if (input.active !== undefined) patch['active'] = input.active;
      if (Object.keys(patch).length === 0) return existing;
      patch['updatedAt'] = new Date();
      const [row] = await tx.update(schema.currencies).set(patch).where(eq(schema.currencies.id, input.id)).returning();
      return row!;
    });
  }

  /** Set the FX rate (1 unit of THIS = fxRate base units). Base currency needs none. */
  async setFxRate(input: SetFxRateInput, actor: Actor, activeGroupId: string | null) {
    const existing = await this.loadOrThrow(input.id);
    assertGroupInScope(existing.groupId, activeGroupId, { message: 'Cannot set FX outside your active company.' });
    if (existing.isDefault) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'The default (base) currency does not take an FX rate.' });
    }
    return withActor(this.db, actor, async (tx) => {
      const [row] = await tx
        .update(schema.currencies)
        .set({ fxRateToBase: sql`${input.fxRate}::numeric`, fxRateUpdatedAt: new Date(), fxRateUpdatedBy: actor.id, updatedAt: new Date() })
        .where(eq(schema.currencies.id, input.id))
        .returning();
      return row!;
    });
  }

  /** Promote a currency to default, demoting the previous default in the same tx. */
  async setDefault(input: SetDefaultCurrencyInput, actor: Actor, activeGroupId: string | null) {
    const existing = await this.loadOrThrow(input.id);
    assertGroupInScope(existing.groupId, activeGroupId, { message: 'Cannot change default outside your active company.' });
    if (existing.isDefault) return existing; // already default
    if (!existing.active) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Activate the currency before making it the default.' });
    }
    return withActor(this.db, actor, async (tx) => {
      await this.demoteDefault(tx, existing.groupId);
      // The new default is the base: it carries no FX rate (rate is relative to base).
      const [row] = await tx
        .update(schema.currencies)
        .set({ isDefault: true, fxRateToBase: null, fxRateUpdatedAt: null, fxRateUpdatedBy: null, updatedAt: new Date() })
        .where(eq(schema.currencies.id, input.id))
        .returning();
      return row!;
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private groupEq(groupId: string | null): SQL {
    return groupId == null ? sql`${schema.currencies.groupId} IS NULL` : eq(schema.currencies.groupId, groupId);
  }

  /** Clear the current default flag for a group (partial-unique index needs exactly one). */
  private async demoteDefault(tx: PostgresJsDatabase<typeof schema>, groupId: string | null): Promise<void> {
    await tx
      .update(schema.currencies)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(this.groupEq(groupId), eq(schema.currencies.isDefault, true)));
  }
}
