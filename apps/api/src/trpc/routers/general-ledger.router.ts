import {
  createJournalEntrySchema,
  listJournalEntriesSchema,
  getJournalEntrySchema,
  reverseJournalEntrySchema,
  approveJournalEntrySchema,
  rejectJournalEntrySchema,
  listAccountsSchema,
  createAccountSchema,
  listFiscalYearsSchema,
  createFiscalYearSchema,
  closeFiscalYearSchema,
  reopenFiscalYearSchema,
  trialBalanceSchema,
  seedChartOfAccountsSchema,
  profitAndLossSchema,
  balanceSheetSchema,
  cashFlowSchema,
  agingSchema,
  postOpeningBalancesSchema,
  financialKPIsSchema,
  createAssetSchema,
  listAssetsSchema,
  getAssetSchema,
  disposeAssetSchema,
  runDepreciationSchema,
  submitExpenseSchema,
  approveExpenseSchema,
  rejectExpenseSchema,
  listExpensesSchema,
  getExpenseSchema,
  budgetVsActualSchema,
  recordWhtSchema,
  listWhtSchema,
  generateWhtCertificateSchema,
  vatReturnSummarySchema,
  createBankReconciliationSchema,
  matchLineSchema,
  unmatchLineSchema,
  completeBankReconciliationSchema,
  listBankReconciliationsSchema,
  getBankReconciliationSchema,
  consolidatedPLSchema,
  consolidatedBSSchema,
  consolidatedCFSchema,
} from '@yannis/shared';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import { GeneralLedgerService } from '../../finance/general-ledger.service';
import { AssetRegisterService } from '../../finance/asset-register.service';
import { ExpenseSubmissionService } from '../../finance/expense-submission.service';
import { BankReconciliationService } from '../../finance/bank-reconciliation.service';
import { isAdminLevel } from '../../common/authz';

let generalLedgerServiceInstance: GeneralLedgerService | null = null;
let assetRegisterServiceInstance: AssetRegisterService | null = null;
let expenseSubmissionServiceInstance: ExpenseSubmissionService | null = null;
let bankReconciliationServiceInstance: BankReconciliationService | null = null;

export function setGeneralLedgerService(service: GeneralLedgerService) {
  generalLedgerServiceInstance = service;
}

export function getGeneralLedgerService(): GeneralLedgerService {
  if (!generalLedgerServiceInstance) {
    throw new Error('GeneralLedgerService not initialized. Call setGeneralLedgerService() first.');
  }
  return generalLedgerServiceInstance;
}

export function setAssetRegisterService(service: AssetRegisterService) {
  assetRegisterServiceInstance = service;
}

export function getAssetRegisterService(): AssetRegisterService {
  if (!assetRegisterServiceInstance) {
    throw new Error('AssetRegisterService not initialized. Call setAssetRegisterService() first.');
  }
  return assetRegisterServiceInstance;
}

export function setExpenseSubmissionService(service: ExpenseSubmissionService) {
  expenseSubmissionServiceInstance = service;
}

export function getExpenseSubmissionService(): ExpenseSubmissionService {
  if (!expenseSubmissionServiceInstance) {
    throw new Error('ExpenseSubmissionService not initialized. Call setExpenseSubmissionService() first.');
  }
  return expenseSubmissionServiceInstance;
}

export function setBankReconciliationService(service: BankReconciliationService) {
  bankReconciliationServiceInstance = service;
}

export function getBankReconciliationService(): BankReconciliationService {
  if (!bankReconciliationServiceInstance) {
    throw new Error('BankReconciliationService not initialized. Call setBankReconciliationService() first.');
  }
  return bankReconciliationServiceInstance;
}

/**
 * Resolve the company (branch group) to scope a ledger operation to. Explicit
 * input wins; otherwise fall back to the request's active company. Phase 1 is
 * single-company, so this is usually null.
 */
function resolveGroupId(
  inputGroupId: string | null | undefined,
  ctxGroupId: string | null,
): string | null {
  return inputGroupId ?? ctxGroupId ?? null;
}

export const generalLedgerRouter = router({
  // ─── Journal Entries ─────────────────────────────────────────────────────
  createJournalEntry: permissionProcedure('finance.ledger.write')
    .input(createJournalEntrySchema)
    .mutation(async ({ input, ctx }) => {
      const groupId = resolveGroupId(input.groupId, ctx.activeGroupId);
      const totalDebit = input.lines.reduce((s, l) => s + (l.debit ?? 0), 0);

      // Threshold check: amounts above ₦500,000 force DRAFT unless the actor
      // has SuperAdmin/SUPPORT role (they bypass permissionProcedure anyway).
      const forceDraft =
        !input.isDraft &&
        totalDebit > GeneralLedgerService.APPROVAL_THRESHOLD &&
        ctx.user.role !== 'SUPER_ADMIN' &&
        ctx.user.role !== 'SUPPORT' &&
        ctx.user.role !== 'ADMIN';

      return getGeneralLedgerService().createJournalEntry(
        { ...input, groupId },
        { id: ctx.user.id },
        forceDraft,
      );
    }),

  approveJournalEntry: permissionProcedure('finance.ledger.write')
    .input(approveJournalEntrySchema)
    .mutation(async ({ input, ctx }) => {
      // Only admin-level roles or FINANCE_OFFICER can approve journal entries.
      if (!isAdminLevel(ctx.user) && ctx.user.role !== 'FINANCE_OFFICER') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only administrators or finance officers can approve journal entries.',
        });
      }
      return getGeneralLedgerService().approveJournalEntry(input, { id: ctx.user.id });
    }),

  rejectJournalEntry: permissionProcedure('finance.ledger.write')
    .input(rejectJournalEntrySchema)
    .mutation(async ({ input, ctx }) => {
      // Only admin-level roles or FINANCE_OFFICER can reject journal entries.
      if (!isAdminLevel(ctx.user) && ctx.user.role !== 'FINANCE_OFFICER') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only administrators or finance officers can reject journal entries.',
        });
      }
      return getGeneralLedgerService().rejectJournalEntry(input, { id: ctx.user.id });
    }),

  reverseJournalEntry: permissionProcedure('finance.ledger.write')
    .input(reverseJournalEntrySchema)
    .mutation(async ({ input, ctx }) => {
      return getGeneralLedgerService().reverseJournalEntry(input, { id: ctx.user.id });
    }),

  listJournalEntries: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(listJournalEntriesSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().listJournalEntries({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  getJournalEntry: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(getJournalEntrySchema)
    .query(async ({ input }) => {
      return getGeneralLedgerService().getJournalEntry(input);
    }),

  // ─── Accounts (Chart of Accounts) ────────────────────────────────────────
  listAccounts: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(listAccountsSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().listAccounts({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  createAccount: permissionProcedure('finance.ledger.write')
    .input(createAccountSchema)
    .mutation(async ({ input, ctx }) => {
      return getGeneralLedgerService().createAccount(
        { ...input, groupId: resolveGroupId(input.groupId, ctx.activeGroupId) },
        { id: ctx.user.id },
      );
    }),

  // ─── Fiscal Years ────────────────────────────────────────────────────────
  listFiscalYears: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(listFiscalYearsSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().listFiscalYears({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  createFiscalYear: permissionProcedure('finance.ledger.write')
    .input(createFiscalYearSchema)
    .mutation(async ({ input, ctx }) => {
      return getGeneralLedgerService().createFiscalYear(
        { ...input, groupId: resolveGroupId(input.groupId, ctx.activeGroupId) },
        { id: ctx.user.id },
      );
    }),

  closeFiscalYear: permissionProcedure('finance.ledger.write')
    .input(closeFiscalYearSchema)
    .mutation(async ({ input, ctx }) => {
      return getGeneralLedgerService().closeFiscalYear(input, { id: ctx.user.id });
    }),

  /** Reopen a closed fiscal year. SuperAdmin-only gate in the router. */
  reopenFiscalYear: permissionProcedure('finance.ledger.write')
    .input(reopenFiscalYearSchema)
    .mutation(async ({ input, ctx }) => {
      // Only admin-level roles can reopen a closed year.
      if (!isAdminLevel(ctx.user)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only administrators can reopen a closed fiscal year.',
        });
      }
      return getGeneralLedgerService().reopenFiscalYear(input, { id: ctx.user.id });
    }),

  // ─── Trial Balance ─────────────────────────────────────────────────────────
  trialBalance: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(trialBalanceSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().trialBalance({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  // ─── Financial statements ────────────────────────────────────────────────
  profitAndLoss: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(profitAndLossSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().profitAndLoss({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  balanceSheet: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(balanceSheetSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().balanceSheet({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  cashFlow: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(cashFlowSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().cashFlow({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  aging: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(agingSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().aging({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  // ─── Financial KPIs (Phase 5A) ────────────────────────────────────────────
  financialKPIs: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(financialKPIsSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().financialKPIs(
        resolveGroupId(input.groupId, ctx.activeGroupId),
        input.asOfDate ?? undefined,
      );
    }),

  // ─── Cutover: opening balances ─────────────────────────────────────────────
  postOpeningBalances: permissionProcedure('finance.ledger.write')
    .input(postOpeningBalancesSchema)
    .mutation(async ({ input, ctx }) => {
      return getGeneralLedgerService().postOpeningBalances(
        { ...input, groupId: resolveGroupId(input.groupId, ctx.activeGroupId) },
        { id: ctx.user.id },
      );
    }),

  // ─── Chart of Accounts seeding (admin / on-demand) ───────────────────────
  seedChartOfAccounts: permissionProcedure('finance.ledger.write')
    .input(seedChartOfAccountsSchema)
    .mutation(async ({ input, ctx }) => {
      return getGeneralLedgerService().seedChartOfAccounts(
        resolveGroupId(input.groupId, ctx.activeGroupId),
        { id: ctx.user.id },
      );
    }),

  // ─── Asset Register (Phase 4A) ──────────────────────────────────────────
  listAssets: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(listAssetsSchema)
    .query(async ({ input, ctx }) => {
      return getAssetRegisterService().listAssets({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  getAsset: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(getAssetSchema)
    .query(async ({ input }) => {
      return getAssetRegisterService().getAsset(input);
    }),

  createAsset: permissionProcedure('finance.ledger.write')
    .input(createAssetSchema)
    .mutation(async ({ input, ctx }) => {
      return getAssetRegisterService().createAsset(
        { ...input, groupId: resolveGroupId(input.groupId, ctx.activeGroupId) },
        { id: ctx.user.id },
      );
    }),

  disposeAsset: permissionProcedure('finance.ledger.write')
    .input(disposeAssetSchema)
    .mutation(async ({ input, ctx }) => {
      return getAssetRegisterService().disposeAsset(input, { id: ctx.user.id });
    }),

  runDepreciation: permissionProcedure('finance.ledger.write')
    .input(runDepreciationSchema)
    .mutation(async ({ input, ctx }) => {
      return getAssetRegisterService().runMonthlyDepreciation(
        { ...input, groupId: resolveGroupId(input.groupId, ctx.activeGroupId) },
        { id: ctx.user.id },
      );
    }),

  // ─── Expense Submissions (Phase 4B) ────────────────────────────────────
  submitExpense: authedProcedure
    .input(submitExpenseSchema)
    .mutation(async ({ input, ctx }) => {
      return getExpenseSubmissionService().submitExpense(
        input,
        { id: ctx.user.id },
        resolveGroupId(null, ctx.activeGroupId),
      );
    }),

  approveExpense: permissionProcedure('finance.ledger.write')
    .input(approveExpenseSchema)
    .mutation(async ({ input, ctx }) => {
      return getExpenseSubmissionService().approveExpense(input, { id: ctx.user.id });
    }),

  rejectExpense: permissionProcedure('finance.ledger.write')
    .input(rejectExpenseSchema)
    .mutation(async ({ input, ctx }) => {
      return getExpenseSubmissionService().rejectExpense(input, { id: ctx.user.id });
    }),

  listExpenses: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(listExpensesSchema)
    .query(async ({ input, ctx }) => {
      return getExpenseSubmissionService().listExpenses({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  getExpense: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(getExpenseSchema)
    .query(async ({ input }) => {
      return getExpenseSubmissionService().getExpense(input);
    }),

  // ─── Phase 6A: Budget vs Actual ─────────────────────────────────────────
  budgetVsActual: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(budgetVsActualSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().budgetVsActual(
        resolveGroupId(input.groupId, ctx.activeGroupId),
        input.startDate ?? undefined,
        input.endDate ?? undefined,
      );
    }),

  // ─── Phase 6B: WHT Deductions ──────────────────────────────────────────
  recordWht: permissionProcedure('finance.ledger.write')
    .input(recordWhtSchema)
    .mutation(async ({ input, ctx }) => {
      return getGeneralLedgerService().recordWhtDeduction(
        { ...input, groupId: resolveGroupId(input.groupId, ctx.activeGroupId) },
        { id: ctx.user.id },
      );
    }),

  listWht: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(listWhtSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().listWhtDeductions({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  generateWhtCertificate: permissionProcedure('finance.ledger.write')
    .input(generateWhtCertificateSchema)
    .mutation(async ({ input, ctx }) => {
      return getGeneralLedgerService().generateWhtCertificate(
        input.deductionId,
        { id: ctx.user.id },
      );
    }),

  // ─── Phase 6C: VAT Return Summary ─────────────────────────────────────
  vatReturnSummary: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(vatReturnSummarySchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().vatReturnSummary(
        resolveGroupId(input.groupId, ctx.activeGroupId),
        input.startDate,
        input.endDate,
      );
    }),

  // ─── Phase 6D: Bank Reconciliation ────────────────────────────────────
  createBankReconciliation: permissionProcedure('finance.ledger.write')
    .input(createBankReconciliationSchema)
    .mutation(async ({ input, ctx }) => {
      return getBankReconciliationService().createReconciliation(
        { ...input, groupId: resolveGroupId(input.groupId, ctx.activeGroupId) },
        { id: ctx.user.id },
      );
    }),

  matchBankReconLine: permissionProcedure('finance.ledger.write')
    .input(matchLineSchema)
    .mutation(async ({ input, ctx }) => {
      return getBankReconciliationService().matchLine(input, { id: ctx.user.id });
    }),

  unmatchBankReconLine: permissionProcedure('finance.ledger.write')
    .input(unmatchLineSchema)
    .mutation(async ({ input, ctx }) => {
      return getBankReconciliationService().unmatchLine(input, { id: ctx.user.id });
    }),

  completeBankReconciliation: permissionProcedure('finance.ledger.write')
    .input(completeBankReconciliationSchema)
    .mutation(async ({ input, ctx }) => {
      return getBankReconciliationService().completeReconciliation(input, { id: ctx.user.id });
    }),

  listBankReconciliations: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(listBankReconciliationsSchema)
    .query(async ({ input, ctx }) => {
      return getBankReconciliationService().listReconciliations({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  getBankReconciliation: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(getBankReconciliationSchema)
    .query(async ({ input }) => {
      return getBankReconciliationService().getReconciliation(input);
    }),

  // ─── Phase 6E: Consolidated Multi-Company Reports ────────────────────
  consolidatedPL: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(consolidatedPLSchema)
    .query(async ({ ctx, input }) => {
      if (!isAdminLevel(ctx.user)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Consolidated reports require admin access.' });
      }
      return getGeneralLedgerService().consolidatedProfitAndLoss(input.startDate, input.endDate);
    }),

  consolidatedBS: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(consolidatedBSSchema)
    .query(async ({ ctx, input }) => {
      if (!isAdminLevel(ctx.user)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Consolidated reports require admin access.' });
      }
      return getGeneralLedgerService().consolidatedBalanceSheet(input.asOfDate);
    }),

  consolidatedCF: permissionProcedure('finance.ledger.read', 'finance.audit.read')
    .input(consolidatedCFSchema)
    .query(async ({ ctx, input }) => {
      if (!isAdminLevel(ctx.user)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Consolidated reports require admin access.' });
      }
      return getGeneralLedgerService().consolidatedCashFlow(input.startDate, input.endDate);
    }),
});
