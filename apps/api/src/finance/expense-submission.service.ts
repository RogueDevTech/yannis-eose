import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, sql, isNull, type SQL, type AnyColumn } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  db as schema,
  ACCT,
  type SubmitExpenseInput,
  type ApproveExpenseInput,
  type RejectExpenseInput,
  type ListExpensesInput,
  type GetExpenseInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import { GeneralLedgerService, type PostVoucherLine } from './general-ledger.service';

type Drizzle = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Drizzle['transaction']>[0]>[0];
type Actor = { id: string };

/**
 * ExpenseSubmissionService — vendor expense claims with receipt upload.
 *
 * Any user can submit. Finance Officers approve (coding the GL account)
 * or reject with a reason. Approval posts the GL journal entry:
 *   Dr [coded account]    amount
 *     Cr Creditors        amount
 */
@Injectable()
export class ExpenseSubmissionService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly generalLedger: GeneralLedgerService,
  ) {}

  // ─── Submit ────────────────────────────────────────────────────────────────

  async submitExpense(input: SubmitExpenseInput, actor: Actor, groupId: string | null) {
    return withActor(this.db, actor, async (tx) => {
      const [row] = await tx
        .insert(schema.expenseSubmissions)
        .values({
          groupId,
          submitterId: actor.id,
          vendorName: input.vendorName,
          description: input.description,
          amount: sql`${input.amount}::numeric`,
          receiptUrl: input.receiptUrl ?? null,
          branchId: input.branchId ?? null,
          status: 'PENDING',
        })
        .returning();
      return row!;
    });
  }

  // ─── Approve ───────────────────────────────────────────────────────────────

  async approveExpense(input: ApproveExpenseInput, actor: Actor) {
    return withActor(this.db, actor, async (tx) => {
      const [expense] = await tx
        .select()
        .from(schema.expenseSubmissions)
        .where(eq(schema.expenseSubmissions.id, input.expenseId))
        .limit(1);

      if (!expense) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Expense submission not found.' });
      }
      if (expense.status !== 'PENDING') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot approve an expense that is already ${expense.status}.`,
        });
      }

      const amount = Number(expense.amount);
      const groupId = expense.groupId ?? null;

      // Resolve the Creditors / Payable account for the credit side.
      const creditorsAcct = await this.resolveAccountByCode(tx, groupId, ACCT.AP_SUPPLIERS);
      if (!creditorsAcct) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Cannot approve: no Creditors/Payable account found in Chart of Accounts.',
        });
      }

      // Build the GL posting: Dr [coded account] / Cr Creditors.
      const today = new Date().toISOString().slice(0, 10);
      const lines: PostVoucherLine[] = [
        {
          accountId: input.glAccountId,
          debit: amount,
          credit: 0,
          remarks: `Vendor expense: ${expense.vendorName} — ${expense.description}`,
        },
        {
          accountId: creditorsAcct.id,
          debit: 0,
          credit: amount,
          remarks: `Vendor expense: ${expense.vendorName}`,
        },
      ];

      // Create the journal entry header.
      const [jeHeader] = await tx
        .insert(schema.journalEntries)
        .values({
          groupId,
          postingDate: today,
          description: `Vendor expense: ${expense.vendorName} — ${expense.description}`,
          totalDebit: sql`${amount}::numeric`,
          totalCredit: sql`${amount}::numeric`,
          status: 'POSTED',
        })
        .returning();

      const { fiscalYearId } = await this.generalLedger.postVoucher(tx, {
        groupId,
        postingDate: today,
        voucherType: 'EXPENSE',
        voucherId: jeHeader!.id,
        lines,
      });

      // Back-link the fiscal year to the JE header.
      await tx
        .update(schema.journalEntries)
        .set({ fiscalYearId, updatedAt: new Date() })
        .where(eq(schema.journalEntries.id, jeHeader!.id));

      // Update the expense submission.
      const [updated] = await tx
        .update(schema.expenseSubmissions)
        .set({
          status: 'APPROVED',
          glAccountId: input.glAccountId,
          approvedBy: actor.id,
          approvedAt: new Date(),
          glVoucherId: jeHeader!.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.expenseSubmissions.id, input.expenseId))
        .returning();

      return updated!;
    });
  }

  // ─── Reject ────────────────────────────────────────────────────────────────

  async rejectExpense(input: RejectExpenseInput, actor: Actor) {
    return withActor(this.db, actor, async (tx) => {
      const [expense] = await tx
        .select()
        .from(schema.expenseSubmissions)
        .where(eq(schema.expenseSubmissions.id, input.expenseId))
        .limit(1);

      if (!expense) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Expense submission not found.' });
      }
      if (expense.status !== 'PENDING') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot reject an expense that is already ${expense.status}.`,
        });
      }

      const [updated] = await tx
        .update(schema.expenseSubmissions)
        .set({
          status: 'REJECTED',
          rejectionReason: input.reason,
          approvedBy: actor.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.expenseSubmissions.id, input.expenseId))
        .returning();

      return updated!;
    });
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  async listExpenses(input: ListExpensesInput) {
    const conds: SQL[] = [this.groupEqOn(schema.expenseSubmissions.groupId, input.groupId ?? null)];
    if (input.status) conds.push(eq(schema.expenseSubmissions.status, input.status));

    const where = and(...conds);
    const offset = (input.page - 1) * input.limit;

    const [rows, totalRow] = await Promise.all([
      this.db
        .select()
        .from(schema.expenseSubmissions)
        .where(where)
        .orderBy(desc(schema.expenseSubmissions.createdAt))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.expenseSubmissions)
        .where(where),
    ]);

    const total = totalRow[0]?.total ?? 0;
    return {
      expenses: rows,
      pagination: {
        total,
        page: input.page,
        pageSize: input.limit,
        totalPages: Math.max(1, Math.ceil(total / input.limit)),
      },
    };
  }

  // ─── Get ───────────────────────────────────────────────────────────────────

  async getExpense(input: GetExpenseInput) {
    const [expense] = await this.db
      .select()
      .from(schema.expenseSubmissions)
      .where(eq(schema.expenseSubmissions.id, input.expenseId))
      .limit(1);
    if (!expense) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Expense submission not found.' });
    }
    return expense;
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /** Resolve a postable leaf account by exact code. */
  private async resolveAccountByCode(
    tx: Tx,
    groupId: string | null,
    code: string,
  ): Promise<{ id: string } | null> {
    const [row] = await tx
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(
        and(
          this.groupEqOn(schema.accounts.groupId, groupId),
          eq(schema.accounts.code, code),
          eq(schema.accounts.isGroup, false),
        ),
      )
      .limit(1);
    return row ? { id: row.id } : null;
  }

  /** Handle null group_id (single-company installs). */
  private groupEqOn(col: AnyColumn, groupId: string | null | undefined): SQL {
    return groupId ? (eq(col, groupId) as SQL) : (isNull(col) as SQL);
  }
}
