/**
 * Default Chart of Accounts — mirrors the client's ERPNext CoA (company "Yannis").
 *
 * Seeded idempotently per company (branch group) on boot and via the
 * `generalLedger.seedChartOfAccounts` mutation. `parentCode` links a row to its
 * parent account by `code`; the seeder resolves it to `parentAccountId` in a
 * second pass. Roots have `parentCode: null`.
 *
 * Single source of truth — revise here and the next boot re-applies additions
 * (ON CONFLICT (group_id, code) DO NOTHING), same pattern as the RBAC catalog.
 */

export type GlRootType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

export type GlAccountType =
  | 'BANK'
  | 'CASH'
  | 'RECEIVABLE'
  | 'PAYABLE'
  | 'STOCK'
  | 'COST_OF_GOODS_SOLD'
  | 'TAX'
  | 'FIXED_ASSET'
  | 'INDIRECT_EXPENSE'
  | 'INDIRECT_INCOME'
  | 'DIRECT_INCOME'
  | 'EQUITY'
  | 'ROUND_OFF'
  | 'TEMPORARY'
  | 'DEPRECIATION'
  | 'EXPENSE_ACCOUNT'
  | 'CHARGEABLE'
  | 'STOCK_RECEIVED_BUT_NOT_BILLED';

export interface ChartOfAccountsEntry {
  /** Unique account code per company. We use the account name as the code (ERPNext uses the name as the identifier). */
  code: string;
  name: string;
  rootType: GlRootType;
  /** Semantic tag; null on group/root accounts. */
  accountType: GlAccountType | null;
  isGroup: boolean;
  /** Parent account `code`, or null for a root. */
  parentCode: string | null;
}

/**
 * The ~89 accounts captured from the client's live ERPNext (2026-07-06).
 * Codes/names are the ERPNext account names without the " - Y" company suffix.
 */
export const DEFAULT_CHART_OF_ACCOUNTS: ChartOfAccountsEntry[] = [
  // ─── Roots ───────────────────────────────────────────────────────────────
  { code: 'Application of Funds (Assets)', name: 'Application of Funds (Assets)', rootType: 'ASSET', accountType: null, isGroup: true, parentCode: null },
  { code: 'Source of Funds (Liabilities)', name: 'Source of Funds (Liabilities)', rootType: 'LIABILITY', accountType: null, isGroup: true, parentCode: null },
  { code: 'Equity', name: 'Equity', rootType: 'EQUITY', accountType: null, isGroup: true, parentCode: null },
  { code: 'Income', name: 'Income', rootType: 'INCOME', accountType: null, isGroup: true, parentCode: null },
  { code: 'Expenses', name: 'Expenses', rootType: 'EXPENSE', accountType: null, isGroup: true, parentCode: null },

  // ─── Assets ──────────────────────────────────────────────────────────────
  { code: 'Current Assets', name: 'Current Assets', rootType: 'ASSET', accountType: null, isGroup: true, parentCode: 'Application of Funds (Assets)' },
  { code: 'Fixed Assets', name: 'Fixed Assets', rootType: 'ASSET', accountType: null, isGroup: true, parentCode: 'Application of Funds (Assets)' },
  { code: 'Investments', name: 'Investments', rootType: 'ASSET', accountType: null, isGroup: true, parentCode: 'Application of Funds (Assets)' },
  { code: 'Temporary Accounts', name: 'Temporary Accounts', rootType: 'ASSET', accountType: null, isGroup: true, parentCode: 'Application of Funds (Assets)' },

  { code: 'Bank Accounts', name: 'Bank Accounts', rootType: 'ASSET', accountType: 'BANK', isGroup: true, parentCode: 'Current Assets' },
  { code: 'First Bank', name: 'First Bank', rootType: 'ASSET', accountType: 'BANK', isGroup: false, parentCode: 'Bank Accounts' },
  { code: 'FCMB', name: 'FCMB', rootType: 'ASSET', accountType: 'BANK', isGroup: false, parentCode: 'Bank Accounts' },
  { code: 'Cash In Hand', name: 'Cash In Hand', rootType: 'ASSET', accountType: 'CASH', isGroup: true, parentCode: 'Current Assets' },
  { code: 'Cash', name: 'Cash', rootType: 'ASSET', accountType: 'CASH', isGroup: false, parentCode: 'Cash In Hand' },
  { code: 'Accounts Receivable', name: 'Accounts Receivable', rootType: 'ASSET', accountType: null, isGroup: true, parentCode: 'Current Assets' },
  { code: 'Debtors', name: 'Debtors', rootType: 'ASSET', accountType: 'RECEIVABLE', isGroup: false, parentCode: 'Accounts Receivable' },
  { code: 'Stock Assets', name: 'Stock Assets', rootType: 'ASSET', accountType: 'STOCK', isGroup: true, parentCode: 'Current Assets' },
  { code: 'Stock In Hand', name: 'Stock In Hand', rootType: 'ASSET', accountType: 'STOCK', isGroup: false, parentCode: 'Stock Assets' },
  { code: 'Tax Assets', name: 'Tax Assets', rootType: 'ASSET', accountType: null, isGroup: true, parentCode: 'Current Assets' },
  { code: 'Loans and Advances (Assets)', name: 'Loans and Advances (Assets)', rootType: 'ASSET', accountType: null, isGroup: true, parentCode: 'Current Assets' },
  { code: 'Employee Advances', name: 'Employee Advances', rootType: 'ASSET', accountType: 'PAYABLE', isGroup: false, parentCode: 'Loans and Advances (Assets)' },
  { code: 'Securities and Deposits', name: 'Securities and Deposits', rootType: 'ASSET', accountType: null, isGroup: true, parentCode: 'Current Assets' },
  { code: 'Earnest Money', name: 'Earnest Money', rootType: 'ASSET', accountType: null, isGroup: false, parentCode: 'Securities and Deposits' },

  { code: 'Buildings', name: 'Buildings', rootType: 'ASSET', accountType: 'FIXED_ASSET', isGroup: false, parentCode: 'Fixed Assets' },
  { code: 'Capital Equipments', name: 'Capital Equipments', rootType: 'ASSET', accountType: 'FIXED_ASSET', isGroup: false, parentCode: 'Fixed Assets' },
  { code: 'Electronic Equipments', name: 'Electronic Equipments', rootType: 'ASSET', accountType: 'FIXED_ASSET', isGroup: false, parentCode: 'Fixed Assets' },
  { code: 'Furnitures and Fixtures', name: 'Furnitures and Fixtures', rootType: 'ASSET', accountType: 'FIXED_ASSET', isGroup: false, parentCode: 'Fixed Assets' },
  { code: 'Office Equipments', name: 'Office Equipments', rootType: 'ASSET', accountType: 'FIXED_ASSET', isGroup: false, parentCode: 'Fixed Assets' },
  { code: 'Plants and Machineries', name: 'Plants and Machineries', rootType: 'ASSET', accountType: 'FIXED_ASSET', isGroup: false, parentCode: 'Fixed Assets' },
  { code: 'Softwares', name: 'Softwares', rootType: 'ASSET', accountType: 'FIXED_ASSET', isGroup: false, parentCode: 'Fixed Assets' },
  { code: 'Accumulated Depreciation', name: 'Accumulated Depreciation', rootType: 'ASSET', accountType: 'DEPRECIATION', isGroup: false, parentCode: 'Fixed Assets' },
  { code: 'CWIP Account', name: 'CWIP Account', rootType: 'ASSET', accountType: null, isGroup: false, parentCode: 'Fixed Assets' },

  { code: 'Temporary Opening', name: 'Temporary Opening', rootType: 'ASSET', accountType: 'TEMPORARY', isGroup: false, parentCode: 'Temporary Accounts' },

  // ─── Liabilities ───────────────────────────────────────────────────────────
  { code: 'Current Liabilities', name: 'Current Liabilities', rootType: 'LIABILITY', accountType: null, isGroup: true, parentCode: 'Source of Funds (Liabilities)' },
  { code: 'Accounts Payable', name: 'Accounts Payable', rootType: 'LIABILITY', accountType: null, isGroup: true, parentCode: 'Current Liabilities' },
  { code: 'Creditors', name: 'Creditors', rootType: 'LIABILITY', accountType: 'PAYABLE', isGroup: false, parentCode: 'Accounts Payable' },
  { code: 'Payroll Payable', name: 'Payroll Payable', rootType: 'LIABILITY', accountType: null, isGroup: false, parentCode: 'Accounts Payable' },
  { code: 'Stock Liabilities', name: 'Stock Liabilities', rootType: 'LIABILITY', accountType: null, isGroup: true, parentCode: 'Current Liabilities' },
  { code: 'Stock Received But Not Billed', name: 'Stock Received But Not Billed', rootType: 'LIABILITY', accountType: 'STOCK_RECEIVED_BUT_NOT_BILLED', isGroup: false, parentCode: 'Stock Liabilities' },
  { code: 'Asset Received But Not Billed', name: 'Asset Received But Not Billed', rootType: 'LIABILITY', accountType: null, isGroup: false, parentCode: 'Stock Liabilities' },
  { code: 'Duties and Taxes', name: 'Duties and Taxes', rootType: 'LIABILITY', accountType: 'TAX', isGroup: true, parentCode: 'Current Liabilities' },
  { code: 'VAT', name: 'VAT', rootType: 'LIABILITY', accountType: 'TAX', isGroup: false, parentCode: 'Duties and Taxes' },
  { code: 'Loans (Liabilities)', name: 'Loans (Liabilities)', rootType: 'LIABILITY', accountType: null, isGroup: true, parentCode: 'Current Liabilities' },
  { code: 'Secured Loans', name: 'Secured Loans', rootType: 'LIABILITY', accountType: null, isGroup: false, parentCode: 'Loans (Liabilities)' },
  { code: 'Unsecured Loans', name: 'Unsecured Loans', rootType: 'LIABILITY', accountType: null, isGroup: false, parentCode: 'Loans (Liabilities)' },
  { code: 'Bank Overdraft Account', name: 'Bank Overdraft Account', rootType: 'LIABILITY', accountType: null, isGroup: false, parentCode: 'Loans (Liabilities)' },

  // ─── Equity ────────────────────────────────────────────────────────────────
  { code: 'Capital Stock', name: 'Capital Stock', rootType: 'EQUITY', accountType: 'EQUITY', isGroup: false, parentCode: 'Equity' },
  { code: 'Dividends Paid', name: 'Dividends Paid', rootType: 'EQUITY', accountType: 'EQUITY', isGroup: false, parentCode: 'Equity' },
  { code: 'Opening Balance Equity', name: 'Opening Balance Equity', rootType: 'EQUITY', accountType: 'EQUITY', isGroup: false, parentCode: 'Equity' },
  { code: 'Retained Earnings', name: 'Retained Earnings', rootType: 'EQUITY', accountType: 'EQUITY', isGroup: false, parentCode: 'Equity' },
  { code: 'Revaluation Surplus', name: 'Revaluation Surplus', rootType: 'EQUITY', accountType: 'EQUITY', isGroup: false, parentCode: 'Equity' },

  // ─── Income ────────────────────────────────────────────────────────────────
  { code: 'Direct Income', name: 'Direct Income', rootType: 'INCOME', accountType: null, isGroup: true, parentCode: 'Income' },
  { code: 'Sale', name: 'Sale', rootType: 'INCOME', accountType: null, isGroup: false, parentCode: 'Direct Income' },
  { code: 'Service', name: 'Service', rootType: 'INCOME', accountType: null, isGroup: false, parentCode: 'Direct Income' },
  { code: 'Indirect Income', name: 'Indirect Income', rootType: 'INCOME', accountType: null, isGroup: true, parentCode: 'Income' },

  // ─── Expenses ──────────────────────────────────────────────────────────────
  { code: 'Direct Expenses', name: 'Direct Expenses', rootType: 'EXPENSE', accountType: null, isGroup: true, parentCode: 'Expenses' },
  { code: 'Stock Expenses', name: 'Stock Expenses', rootType: 'EXPENSE', accountType: null, isGroup: true, parentCode: 'Direct Expenses' },
  { code: 'Cost of Goods Sold', name: 'Cost of Goods Sold', rootType: 'EXPENSE', accountType: 'COST_OF_GOODS_SOLD', isGroup: false, parentCode: 'Stock Expenses' },
  { code: 'Expenses Included In Asset Valuation', name: 'Expenses Included In Asset Valuation', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Stock Expenses' },
  { code: 'Expenses Included In Valuation', name: 'Expenses Included In Valuation', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Stock Expenses' },
  { code: 'Stock Adjustment', name: 'Stock Adjustment', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Stock Expenses' },
  { code: 'Indirect Expenses', name: 'Indirect Expenses', rootType: 'EXPENSE', accountType: null, isGroup: true, parentCode: 'Expenses' },
  { code: 'Administrative Expenses', name: 'Administrative Expenses', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Commission on Sales', name: 'Commission on Sales', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Delivery Fees', name: 'Delivery Fees', rootType: 'EXPENSE', accountType: 'INDIRECT_EXPENSE', isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Discount Fees', name: 'Discount Fees', rootType: 'EXPENSE', accountType: 'INDIRECT_EXPENSE', isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Depreciation', name: 'Depreciation', rootType: 'EXPENSE', accountType: 'DEPRECIATION', isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Entertainment Expenses', name: 'Entertainment Expenses', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Exchange Gain/Loss', name: 'Exchange Gain/Loss', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Freight and Forwarding Charges', name: 'Freight and Forwarding Charges', rootType: 'EXPENSE', accountType: 'CHARGEABLE', isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Gain/Loss on Asset Disposal', name: 'Gain/Loss on Asset Disposal', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Impairment', name: 'Impairment', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Internet Expense', name: 'Internet Expense', rootType: 'EXPENSE', accountType: 'INDIRECT_EXPENSE', isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Legal Expenses', name: 'Legal Expenses', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Marketing Expenses', name: 'Marketing Expenses', rootType: 'EXPENSE', accountType: 'CHARGEABLE', isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Miscellaneous Expenses', name: 'Miscellaneous Expenses', rootType: 'EXPENSE', accountType: 'CHARGEABLE', isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Office Maintenance Expenses', name: 'Office Maintenance Expenses', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Office Rent', name: 'Office Rent', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Postal Expenses', name: 'Postal Expenses', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Print and Stationery', name: 'Print and Stationery', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Round Off', name: 'Round Off', rootType: 'EXPENSE', accountType: 'ROUND_OFF', isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Salary', name: 'Salary', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Sales Expenses', name: 'Sales Expenses', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Telephone Expenses', name: 'Telephone Expenses', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Travel Expenses', name: 'Travel Expenses', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Utility Expenses', name: 'Utility Expenses', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
  { code: 'Write Off', name: 'Write Off', rootType: 'EXPENSE', accountType: null, isGroup: false, parentCode: 'Indirect Expenses' },
];
