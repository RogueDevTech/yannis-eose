import {
  createJournalEntrySchema,
  listJournalEntriesSchema,
  getJournalEntrySchema,
  reverseJournalEntrySchema,
  listAccountsSchema,
  createAccountSchema,
  listFiscalYearsSchema,
  createFiscalYearSchema,
  closeFiscalYearSchema,
  trialBalanceSchema,
  seedChartOfAccountsSchema,
  profitAndLossSchema,
  balanceSheetSchema,
  cashFlowSchema,
  agingSchema,
  postOpeningBalancesSchema,
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
} from '@yannis/shared';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import { GeneralLedgerService } from '../../finance/general-ledger.service';
import { AssetRegisterService } from '../../finance/asset-register.service';
import { ExpenseSubmissionService } from '../../finance/expense-submission.service';

let generalLedgerServiceInstance: GeneralLedgerService | null = null;
let assetRegisterServiceInstance: AssetRegisterService | null = null;
let expenseSubmissionServiceInstance: ExpenseSubmissionService | null = null;

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
      return getGeneralLedgerService().createJournalEntry(
        { ...input, groupId: resolveGroupId(input.groupId, ctx.activeGroupId) },
        { id: ctx.user.id },
      );
    }),

  reverseJournalEntry: permissionProcedure('finance.ledger.write')
    .input(reverseJournalEntrySchema)
    .mutation(async ({ input, ctx }) => {
      return getGeneralLedgerService().reverseJournalEntry(input, { id: ctx.user.id });
    }),

  listJournalEntries: permissionProcedure('finance.ledger.read')
    .input(listJournalEntriesSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().listJournalEntries({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  getJournalEntry: permissionProcedure('finance.ledger.read')
    .input(getJournalEntrySchema)
    .query(async ({ input }) => {
      return getGeneralLedgerService().getJournalEntry(input);
    }),

  // ─── Accounts (Chart of Accounts) ────────────────────────────────────────
  listAccounts: permissionProcedure('finance.ledger.read')
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
  listFiscalYears: permissionProcedure('finance.ledger.read')
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

  // ─── Trial Balance ─────────────────────────────────────────────────────────
  trialBalance: permissionProcedure('finance.ledger.read')
    .input(trialBalanceSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().trialBalance({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  // ─── Financial statements ────────────────────────────────────────────────
  profitAndLoss: permissionProcedure('finance.ledger.read')
    .input(profitAndLossSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().profitAndLoss({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  balanceSheet: permissionProcedure('finance.ledger.read')
    .input(balanceSheetSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().balanceSheet({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  cashFlow: permissionProcedure('finance.ledger.read')
    .input(cashFlowSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().cashFlow({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  aging: permissionProcedure('finance.ledger.read')
    .input(agingSchema)
    .query(async ({ input, ctx }) => {
      return getGeneralLedgerService().aging({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
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
  listAssets: permissionProcedure('finance.ledger.read')
    .input(listAssetsSchema)
    .query(async ({ input, ctx }) => {
      return getAssetRegisterService().listAssets({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  getAsset: permissionProcedure('finance.ledger.read')
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

  listExpenses: permissionProcedure('finance.ledger.read')
    .input(listExpensesSchema)
    .query(async ({ input, ctx }) => {
      return getExpenseSubmissionService().listExpenses({
        ...input,
        groupId: resolveGroupId(input.groupId, ctx.activeGroupId),
      });
    }),

  getExpense: permissionProcedure('finance.ledger.read')
    .input(getExpenseSchema)
    .query(async ({ input }) => {
      return getExpenseSubmissionService().getExpense(input);
    }),
});
