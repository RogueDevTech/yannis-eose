import { z } from 'zod';

// ============================================
// Double-Entry General Ledger Validators (Phase 1)
//
// Balance checks run in integer minor units (×100) to avoid float drift.
// The server re-validates every rule in the posting service regardless.
// ============================================

const GL_ROOT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;

const GL_ACCOUNT_TYPES = [
  'BANK',
  'CASH',
  'RECEIVABLE',
  'PAYABLE',
  'STOCK',
  'COST_OF_GOODS_SOLD',
  'TAX',
  'FIXED_ASSET',
  'INDIRECT_EXPENSE',
  'INDIRECT_INCOME',
  'DIRECT_INCOME',
  'EQUITY',
  'ROUND_OFF',
  'TEMPORARY',
  'DEPRECIATION',
  'EXPENSE_ACCOUNT',
  'CHARGEABLE',
  'STOCK_RECEIVED_BUT_NOT_BILLED',
] as const;

const minor = (n: number) => Math.round(n * 100);

// ─── Journal Entries ─────────────────────────────────────────────────────────

export const glLineSchema = z
  .object({
    accountId: z.string().uuid(),
    debit: z.coerce.number().nonnegative().multipleOf(0.01).default(0),
    credit: z.coerce.number().nonnegative().multipleOf(0.01).default(0),
    partyType: z.string().trim().max(40).optional(),
    partyId: z.string().uuid().optional(),
    remarks: z.string().trim().max(500).optional(),
  })
  .refine((l) => (minor(l.debit) > 0) !== (minor(l.credit) > 0), {
    message: 'Each line must be one-sided: exactly one of debit or credit must be > 0.',
  });
export type GlLineInput = z.infer<typeof glLineSchema>;

export const createJournalEntrySchema = z
  .object({
    groupId: z.string().uuid().nullish(),
    postingDate: z.string().date(),
    description: z.string().trim().min(1).max(500),
    lines: z.array(glLineSchema).min(2),
  })
  .superRefine((v, ctx) => {
    const totalDebit = v.lines.reduce((s, l) => s + minor(l.debit), 0);
    const totalCredit = v.lines.reduce((s, l) => s + minor(l.credit), 0);
    if (totalDebit !== totalCredit) {
      ctx.addIssue({
        code: 'custom',
        message: `Unbalanced entry: debit ${totalDebit / 100} ≠ credit ${totalCredit / 100}.`,
      });
    }
    if (totalDebit === 0) {
      ctx.addIssue({ code: 'custom', message: 'Total must be greater than zero.' });
    }
  });
export type CreateJournalEntryInput = z.infer<typeof createJournalEntrySchema>;

export const listJournalEntriesSchema = z.object({
  groupId: z.string().uuid().nullish(),
  status: z.enum(['POSTED', 'CANCELLED']).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  search: z.string().trim().max(200).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(500).default(50),
});
export type ListJournalEntriesInput = z.infer<typeof listJournalEntriesSchema>;

export const getJournalEntrySchema = z.object({
  journalEntryId: z.string().uuid(),
});
export type GetJournalEntryInput = z.infer<typeof getJournalEntrySchema>;

export const reverseJournalEntrySchema = z.object({
  journalEntryId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500).optional(),
});
export type ReverseJournalEntryInput = z.infer<typeof reverseJournalEntrySchema>;

// ─── Accounts (Chart of Accounts) ──────────────────────────────────────────────

export const listAccountsSchema = z.object({
  groupId: z.string().uuid().nullish(),
  includeInactive: z.boolean().default(false),
});
export type ListAccountsInput = z.infer<typeof listAccountsSchema>;

export const createAccountSchema = z.object({
  groupId: z.string().uuid().nullish(),
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  rootType: z.enum(GL_ROOT_TYPES),
  accountType: z.enum(GL_ACCOUNT_TYPES).nullish(),
  isGroup: z.boolean().default(false),
  parentAccountId: z.string().uuid().nullish(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

// ─── Fiscal Years ──────────────────────────────────────────────────────────────

export const listFiscalYearsSchema = z.object({
  groupId: z.string().uuid().nullish(),
});
export type ListFiscalYearsInput = z.infer<typeof listFiscalYearsSchema>;

export const createFiscalYearSchema = z
  .object({
    groupId: z.string().uuid().nullish(),
    name: z.string().trim().min(1).max(60),
    startDate: z.string().date(),
    endDate: z.string().date(),
  })
  .refine((v) => v.startDate < v.endDate, {
    message: 'Start date must be before end date.',
  });
export type CreateFiscalYearInput = z.infer<typeof createFiscalYearSchema>;

export const closeFiscalYearSchema = z.object({
  fiscalYearId: z.string().uuid(),
});
export type CloseFiscalYearInput = z.infer<typeof closeFiscalYearSchema>;

// ─── Trial Balance + Seeding ────────────────────────────────────────────────────

export const trialBalanceSchema = z.object({
  groupId: z.string().uuid().nullish(),
  asOfDate: z.string().date().optional(),
});
export type TrialBalanceInput = z.infer<typeof trialBalanceSchema>;

export const seedChartOfAccountsSchema = z.object({
  groupId: z.string().uuid().nullish(),
});
export type SeedChartOfAccountsInput = z.infer<typeof seedChartOfAccountsSchema>;

// ─── Financial statements (Phase 5) ─────────────────────────────────────────────

export const profitAndLossSchema = z.object({
  groupId: z.string().uuid().nullish(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
});
export type ProfitAndLossInput = z.infer<typeof profitAndLossSchema>;

export const balanceSheetSchema = z.object({
  groupId: z.string().uuid().nullish(),
  asOfDate: z.string().date().optional(),
});
export type BalanceSheetInput = z.infer<typeof balanceSheetSchema>;

export const cashFlowSchema = z.object({
  groupId: z.string().uuid().nullish(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
});
export type CashFlowInput = z.infer<typeof cashFlowSchema>;

export const agingSchema = z.object({
  groupId: z.string().uuid().nullish(),
  kind: z.enum(['RECEIVABLE', 'PAYABLE']).default('RECEIVABLE'),
  asOfDate: z.string().date().optional(),
});
export type AgingInput = z.infer<typeof agingSchema>;

// ─── Financial KPIs (Phase 5A) ─────────────────────────────────────────────────

export const financialKPIsSchema = z.object({
  groupId: z.string().uuid().nullish(),
  asOfDate: z.string().date().optional(),
});
export type FinancialKPIsInput = z.infer<typeof financialKPIsSchema>;

export interface FinancialKPIs {
  currentRatio: number;
  quickRatio: number;
  cashRatio: number;
  grossProfitMargin: number;
  operatingProfitMargin: number;
  netProfitMargin: number;
  returnOnAssets: number;
  returnOnEquity: number;
  debtToEquity: number;
  daysSalesOutstanding: number;
  inventoryTurnover: number;
  daysInventoryOutstanding: number;
  interestCoverage: number;
  cashConversionCycle: number;
}

// ─── Opening balances / cutover (Phase 6) ───────────────────────────────────────

export const openingBalanceLineSchema = z
  .object({
    accountId: z.string().uuid(),
    debit: z.coerce.number().nonnegative().multipleOf(0.01).default(0),
    credit: z.coerce.number().nonnegative().multipleOf(0.01).default(0),
  })
  .refine((l) => (l.debit > 0) !== (l.credit > 0), {
    message: 'Each opening line must be one-sided.',
  });
export type OpeningBalanceLineInput = z.infer<typeof openingBalanceLineSchema>;

export const postOpeningBalancesSchema = z.object({
  groupId: z.string().uuid().nullish(),
  postingDate: z.string().date(),
  lines: z.array(openingBalanceLineSchema).min(1),
});
export type PostOpeningBalancesInput = z.infer<typeof postOpeningBalancesSchema>;
