import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, sql, gte, lte, isNull, type SQL, type AnyColumn } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  db as schema,
  type CreateBankReconciliationInput,
  type MatchLineInput,
  type UnmatchLineInput,
  type CompleteBankReconciliationInput,
  type ListBankReconciliationsInput,
  type GetBankReconciliationInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';

type Actor = { id: string };

/**
 * BankReconciliationService — Phase 6D.
 *
 * Reconciles bank statement lines against GL entries for BANK-type accounts.
 * Auto-matches by amount + date (within +/- 2 days) on creation.
 */
@Injectable()
export class BankReconciliationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  private groupEqOn(col: AnyColumn, groupId: string | null | undefined): SQL {
    return groupId ? (eq(col, groupId) as SQL) : (isNull(col) as SQL);
  }

  /**
   * Get the GL balance for a bank account: SUM(debit - credit) on gl_entries
   * for that account up to the statement date.
   */
  private async getGlBalance(
    bankAccountId: string,
    asOfDate: string,
  ): Promise<number> {
    const [row] = await this.db
      .select({
        net: sql<string>`COALESCE(SUM(${schema.glEntries.debit} - ${schema.glEntries.credit}), 0)`,
      })
      .from(schema.glEntries)
      .where(
        and(
          eq(schema.glEntries.accountId, bankAccountId),
          lte(schema.glEntries.postingDate, asOfDate),
        ),
      );
    return Number(row?.net ?? 0);
  }

  async createReconciliation(
    input: CreateBankReconciliationInput,
    actor: Actor,
  ) {
    const groupId = input.groupId ?? null;

    // Verify the bank account exists and is a BANK type
    const [bankAccount] = await this.db
      .select({ id: schema.accounts.id, accountType: schema.accounts.accountType })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, input.bankAccountId))
      .limit(1);

    if (!bankAccount) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Bank account not found.' });
    }
    if (bankAccount.accountType !== 'BANK') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Account must be of type BANK.' });
    }

    const glBalance = await this.getGlBalance(input.bankAccountId, input.statementDate);
    const difference = input.statementBalance - glBalance;

    return withActor(this.db, actor, async (tx) => {
      // Create header
      const [header] = await tx
        .insert(schema.bankReconciliations)
        .values({
          groupId,
          bankAccountId: input.bankAccountId,
          statementDate: input.statementDate,
          statementBalance: sql`${input.statementBalance}::numeric`,
          glBalance: sql`${glBalance}::numeric`,
          difference: sql`${difference}::numeric`,
          status: 'IN_PROGRESS',
          createdBy: actor.id,
        })
        .returning();

      if (!header) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create reconciliation.' });
      }

      // Insert statement lines
      for (const line of input.statementLines) {
        await tx.insert(schema.bankReconLines).values({
          reconciliationId: header.id,
          statementDate: line.date,
          statementDescription: line.description,
          statementAmount: sql`${line.amount}::numeric`,
          status: 'UNMATCHED',
        });
      }

      // Auto-match: for each statement line, find GL entries on the same bank
      // account within +/- 2 days with matching absolute amount.
      const insertedLines = await tx
        .select()
        .from(schema.bankReconLines)
        .where(eq(schema.bankReconLines.reconciliationId, header.id));

      for (const stmtLine of insertedLines) {
        if (!stmtLine.statementDate || stmtLine.statementAmount === null) continue;

        const absAmount = Math.abs(Number(stmtLine.statementAmount));
        // Find GL entries within +/- 2 days with matching absolute amount
        const candidates = await tx
          .select({
            id: schema.glEntries.id,
            postingDate: schema.glEntries.postingDate,
            debit: schema.glEntries.debit,
            credit: schema.glEntries.credit,
            remarks: schema.glEntries.remarks,
          })
          .from(schema.glEntries)
          .where(
            and(
              eq(schema.glEntries.accountId, input.bankAccountId),
              gte(schema.glEntries.postingDate, sql`(${stmtLine.statementDate}::date - INTERVAL '2 days')::date`),
              lte(schema.glEntries.postingDate, sql`(${stmtLine.statementDate}::date + INTERVAL '2 days')::date`),
              sql`ABS(${schema.glEntries.debit} - ${schema.glEntries.credit}) = ${absAmount}::numeric`,
            ),
          );

        // Only auto-match if exactly one candidate
        if (candidates.length === 1 && candidates[0]) {
          const gl = candidates[0];
          const glAmount = Number(gl.debit) - Number(gl.credit);
          await tx
            .update(schema.bankReconLines)
            .set({
              glEntryId: gl.id,
              glDate: gl.postingDate,
              glDescription: gl.remarks,
              glAmount: sql`${glAmount}::numeric`,
              status: 'MATCHED',
              matchedAt: new Date(),
            })
            .where(eq(schema.bankReconLines.id, stmtLine.id));
        }
      }

      return { ...header, glBalance };
    });
  }

  async matchLine(input: MatchLineInput, actor: Actor) {
    const [line] = await this.db
      .select()
      .from(schema.bankReconLines)
      .where(eq(schema.bankReconLines.id, input.lineId))
      .limit(1);

    if (!line) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Reconciliation line not found.' });
    }

    // Get the GL entry
    const [glEntry] = await this.db
      .select({
        id: schema.glEntries.id,
        postingDate: schema.glEntries.postingDate,
        debit: schema.glEntries.debit,
        credit: schema.glEntries.credit,
        remarks: schema.glEntries.remarks,
      })
      .from(schema.glEntries)
      .where(eq(schema.glEntries.id, input.glEntryId))
      .limit(1);

    if (!glEntry) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'GL entry not found.' });
    }

    const glAmount = Number(glEntry.debit) - Number(glEntry.credit);

    return withActor(this.db, actor, async (tx) => {
      const [updated] = await tx
        .update(schema.bankReconLines)
        .set({
          glEntryId: glEntry.id,
          glDate: glEntry.postingDate,
          glDescription: glEntry.remarks,
          glAmount: sql`${glAmount}::numeric`,
          status: 'MATCHED',
          matchedAt: new Date(),
        })
        .where(eq(schema.bankReconLines.id, input.lineId))
        .returning();

      return updated;
    });
  }

  async unmatchLine(input: UnmatchLineInput, actor: Actor) {
    const [line] = await this.db
      .select()
      .from(schema.bankReconLines)
      .where(eq(schema.bankReconLines.id, input.lineId))
      .limit(1);

    if (!line) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Reconciliation line not found.' });
    }

    return withActor(this.db, actor, async (tx) => {
      const [updated] = await tx
        .update(schema.bankReconLines)
        .set({
          glEntryId: null,
          glDate: null,
          glDescription: null,
          glAmount: null,
          status: 'UNMATCHED',
          matchedAt: null,
        })
        .where(eq(schema.bankReconLines.id, input.lineId))
        .returning();

      return updated;
    });
  }

  async completeReconciliation(input: CompleteBankReconciliationInput, actor: Actor) {
    const [recon] = await this.db
      .select()
      .from(schema.bankReconciliations)
      .where(eq(schema.bankReconciliations.id, input.reconciliationId))
      .limit(1);

    if (!recon) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Reconciliation not found.' });
    }

    if (recon.status === 'COMPLETED') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Reconciliation already completed.' });
    }

    const difference = Number(recon.statementBalance) - Number(recon.glBalance);

    return withActor(this.db, actor, async (tx) => {
      const [updated] = await tx
        .update(schema.bankReconciliations)
        .set({
          status: 'COMPLETED',
          difference: sql`${difference}::numeric`,
          completedBy: actor.id,
          completedAt: new Date(),
        })
        .where(eq(schema.bankReconciliations.id, input.reconciliationId))
        .returning();

      return updated;
    });
  }

  async listReconciliations(input: ListBankReconciliationsInput) {
    const groupId = input.groupId ?? null;
    const offset = (input.page - 1) * input.limit;

    const conds: SQL[] = [this.groupEqOn(schema.bankReconciliations.groupId, groupId)];

    const [rows, countRows] = await Promise.all([
      this.db
        .select({
          id: schema.bankReconciliations.id,
          bankAccountId: schema.bankReconciliations.bankAccountId,
          bankAccountName: schema.accounts.name,
          statementDate: schema.bankReconciliations.statementDate,
          statementBalance: schema.bankReconciliations.statementBalance,
          glBalance: schema.bankReconciliations.glBalance,
          difference: schema.bankReconciliations.difference,
          status: schema.bankReconciliations.status,
          completedAt: schema.bankReconciliations.completedAt,
          createdAt: schema.bankReconciliations.createdAt,
        })
        .from(schema.bankReconciliations)
        .leftJoin(schema.accounts, eq(schema.bankReconciliations.bankAccountId, schema.accounts.id))
        .where(and(...conds))
        .orderBy(desc(schema.bankReconciliations.createdAt))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ count: sql<string>`COUNT(*)` })
        .from(schema.bankReconciliations)
        .where(and(...conds)),
    ]);

    return {
      reconciliations: rows.map((r) => ({
        ...r,
        statementBalance: Number(r.statementBalance),
        glBalance: Number(r.glBalance),
        difference: Number(r.difference),
      })),
      pagination: {
        page: input.page,
        limit: input.limit,
        total: Number(countRows[0]?.count ?? 0),
      },
    };
  }

  async getReconciliation(input: GetBankReconciliationInput) {
    const [recon] = await this.db
      .select({
        id: schema.bankReconciliations.id,
        groupId: schema.bankReconciliations.groupId,
        bankAccountId: schema.bankReconciliations.bankAccountId,
        bankAccountName: schema.accounts.name,
        statementDate: schema.bankReconciliations.statementDate,
        statementBalance: schema.bankReconciliations.statementBalance,
        glBalance: schema.bankReconciliations.glBalance,
        difference: schema.bankReconciliations.difference,
        status: schema.bankReconciliations.status,
        completedBy: schema.bankReconciliations.completedBy,
        completedAt: schema.bankReconciliations.completedAt,
        createdBy: schema.bankReconciliations.createdBy,
        createdAt: schema.bankReconciliations.createdAt,
      })
      .from(schema.bankReconciliations)
      .leftJoin(schema.accounts, eq(schema.bankReconciliations.bankAccountId, schema.accounts.id))
      .where(eq(schema.bankReconciliations.id, input.reconciliationId))
      .limit(1);

    if (!recon) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Reconciliation not found.' });
    }

    const lines = await this.db
      .select()
      .from(schema.bankReconLines)
      .where(eq(schema.bankReconLines.reconciliationId, input.reconciliationId))
      .orderBy(schema.bankReconLines.statementDate);

    return {
      ...recon,
      statementBalance: Number(recon.statementBalance),
      glBalance: Number(recon.glBalance),
      difference: Number(recon.difference),
      lines: lines.map((l) => ({
        ...l,
        statementAmount: l.statementAmount ? Number(l.statementAmount) : null,
        glAmount: l.glAmount ? Number(l.glAmount) : null,
      })),
    };
  }
}
