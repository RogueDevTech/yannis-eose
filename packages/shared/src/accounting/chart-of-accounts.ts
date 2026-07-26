/**
 * Default Chart of Accounts — simplified Nigerian structure.
 *
 * Flat hierarchy: 7 root groups + leaf accounts directly under them.
 * Only accounts actually used by the auto-posting engine or needed
 * for financial reports are included.
 *
 *   1000s = Assets, 2000s = Liabilities, 3000s = Equity,
 *   4000s = Revenue, 5000s = Cost of Sales, 6000s = Operating Expenses,
 *   7000s = Other Income/Finance Costs, 8000s = Tax.
 *
 * Seeded idempotently per company (branch group) on boot. `parentCode`
 * links a row to its parent by `code`; the seeder resolves it to
 * `parentAccountId` in a second pass.
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
  /** 4-digit IFRS account code (unique per company). */
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
 * Simplified Chart of Accounts — flat structure.
 * 7 root groups, all leaf accounts sit directly under their root.
 */
export const DEFAULT_CHART_OF_ACCOUNTS: ChartOfAccountsEntry[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // 1000 — ASSETS
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '1000', name: 'Assets',                            rootType: 'ASSET',     accountType: null,                 isGroup: true,  parentCode: null },
  { code: '1111', name: 'Petty Cash',                         rootType: 'ASSET',     accountType: 'CASH',               isGroup: false, parentCode: '1000' },
  { code: '1112', name: 'Bank Account',                      rootType: 'ASSET',     accountType: 'BANK',               isGroup: false, parentCode: '1000' },
  { code: '1121', name: 'Accounts Receivable',               rootType: 'ASSET',     accountType: 'RECEIVABLE',         isGroup: false, parentCode: '1000' },
  { code: '1131', name: 'Finished Goods Stock',              rootType: 'ASSET',     accountType: 'STOCK',              isGroup: false, parentCode: '1000' },
  { code: '1132', name: 'Goods in Transit',                  rootType: 'ASSET',     accountType: 'STOCK',              isGroup: false, parentCode: '1000' },
  { code: '1133', name: 'Stock Held by Agents',              rootType: 'ASSET',     accountType: 'STOCK',              isGroup: false, parentCode: '1000' },
  { code: '1151', name: 'VAT Input Credit',                  rootType: 'ASSET',     accountType: 'TAX',                isGroup: false, parentCode: '1000' },
  { code: '1221', name: 'Accumulated Depreciation',          rootType: 'ASSET',     accountType: 'DEPRECIATION',       isGroup: false, parentCode: '1000' },

  // ═══════════════════════════════════════════════════════════════════════════
  // 2000 — LIABILITIES
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '2000', name: 'Liabilities',                       rootType: 'LIABILITY', accountType: null,                 isGroup: true,  parentCode: null },
  { code: '2111', name: 'Accounts Payable (Suppliers)',      rootType: 'LIABILITY', accountType: 'PAYABLE',            isGroup: false, parentCode: '2000' },
  { code: '2112', name: 'Agent Commissions Payable',         rootType: 'LIABILITY', accountType: 'PAYABLE',            isGroup: false, parentCode: '2000' },
  { code: '2121', name: 'Accrued Salaries',                  rootType: 'LIABILITY', accountType: null,                 isGroup: false, parentCode: '2000' },
  { code: '2122', name: 'Accrued Logistics Costs',           rootType: 'LIABILITY', accountType: null,                 isGroup: false, parentCode: '2000' },
  { code: '2141', name: 'VAT Payable',                       rootType: 'LIABILITY', accountType: 'TAX',                isGroup: false, parentCode: '2000' },
  { code: '2142', name: 'Withholding Tax Payable',           rootType: 'LIABILITY', accountType: 'TAX',                isGroup: false, parentCode: '2000' },
  { code: '2143', name: 'PAYE Tax Payable',                  rootType: 'LIABILITY', accountType: 'TAX',                isGroup: false, parentCode: '2000' },
  { code: '2144', name: 'Pension Payable',                   rootType: 'LIABILITY', accountType: null,                 isGroup: false, parentCode: '2000' },
  { code: '2150', name: 'Customer Deposits',                 rootType: 'LIABILITY', accountType: null,                 isGroup: false, parentCode: '2000' },

  // ═══════════════════════════════════════════════════════════════════════════
  // 3000 — EQUITY
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '3000', name: 'Equity',                            rootType: 'EQUITY',    accountType: null,                 isGroup: true,  parentCode: null },
  { code: '3110', name: 'Share Capital',                     rootType: 'EQUITY',    accountType: 'EQUITY',             isGroup: false, parentCode: '3000' },
  { code: '3210', name: 'Retained Earnings',                 rootType: 'EQUITY',    accountType: 'EQUITY',             isGroup: false, parentCode: '3000' },
  { code: '3220', name: 'Current Year Profit/Loss',          rootType: 'EQUITY',    accountType: 'EQUITY',             isGroup: false, parentCode: '3000' },
  { code: '3900', name: 'Opening Balance Equity',            rootType: 'EQUITY',    accountType: 'EQUITY',             isGroup: false, parentCode: '3000' },

  // ═══════════════════════════════════════════════════════════════════════════
  // 4000 — REVENUE
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '4000', name: 'Revenue',                           rootType: 'INCOME',    accountType: null,                 isGroup: true,  parentCode: null },
  { code: '4110', name: 'Product Sales',                     rootType: 'INCOME',    accountType: 'DIRECT_INCOME',      isGroup: false, parentCode: '4000' },
  { code: '4120', name: 'Service Revenue',                   rootType: 'INCOME',    accountType: 'DIRECT_INCOME',      isGroup: false, parentCode: '4000' },
  { code: '4210', name: 'Delivery Charges Billed',           rootType: 'INCOME',    accountType: 'INDIRECT_INCOME',    isGroup: false, parentCode: '4000' },

  // ═══════════════════════════════════════════════════════════════════════════
  // 5000 — COST OF SALES
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '5000', name: 'Cost of Sales',                     rootType: 'EXPENSE',   accountType: null,                 isGroup: true,  parentCode: null },
  { code: '5110', name: 'Product Purchase Cost',             rootType: 'EXPENSE',   accountType: 'COST_OF_GOODS_SOLD', isGroup: false, parentCode: '5000' },
  { code: '5120', name: 'Inbound Logistics',                 rootType: 'EXPENSE',   accountType: 'COST_OF_GOODS_SOLD', isGroup: false, parentCode: '5000' },
  { code: '5130', name: 'Offloading and Handling',           rootType: 'EXPENSE',   accountType: 'COST_OF_GOODS_SOLD', isGroup: false, parentCode: '5000' },
  { code: '5140', name: 'Import Duties',                     rootType: 'EXPENSE',   accountType: 'COST_OF_GOODS_SOLD', isGroup: false, parentCode: '5000' },
  { code: '5210', name: 'Closer Commissions',                rootType: 'EXPENSE',   accountType: 'CHARGEABLE',         isGroup: false, parentCode: '5000' },
  { code: '5220', name: 'Agent Delivery Commission',         rootType: 'EXPENSE',   accountType: 'CHARGEABLE',         isGroup: false, parentCode: '5000' },

  // ═══════════════════════════════════════════════════════════════════════════
  // 6000 — OPERATING EXPENSES
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '6000', name: 'Operating Expenses',                rootType: 'EXPENSE',   accountType: null,                 isGroup: true,  parentCode: null },
  { code: '6110', name: 'Staff Salaries',                    rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',   isGroup: false, parentCode: '6000' },
  { code: '6210', name: 'Digital Advertising Spend',         rootType: 'EXPENSE',   accountType: 'CHARGEABLE',         isGroup: false, parentCode: '6000' },
  { code: '6310', name: 'Outbound Delivery Costs',           rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',   isGroup: false, parentCode: '6000' },
  { code: '6510', name: 'Depreciation',                      rootType: 'EXPENSE',   accountType: 'DEPRECIATION',       isGroup: false, parentCode: '6000' },
  { code: '6630', name: 'Bank Charges',                      rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',   isGroup: false, parentCode: '6000' },
  { code: '6900', name: 'Miscellaneous Expenses',            rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',   isGroup: false, parentCode: '6000' },
  { code: '6910', name: 'Round Off',                         rootType: 'EXPENSE',   accountType: 'ROUND_OFF',          isGroup: false, parentCode: '6000' },
  { code: '6930', name: 'Stock Adjustment',                  rootType: 'EXPENSE',   accountType: null,                 isGroup: false, parentCode: '6000' },

  // ═══════════════════════════════════════════════════════════════════════════
  // 7000 — OTHER INCOME / FINANCE COSTS
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '7000', name: 'Other Income and Finance Costs',    rootType: 'EXPENSE',   accountType: null,                 isGroup: true,  parentCode: null },
  { code: '7110', name: 'Interest Income',                   rootType: 'INCOME',    accountType: 'INDIRECT_INCOME',    isGroup: false, parentCode: '7000' },
  { code: '7210', name: 'Interest Expense',                  rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',   isGroup: false, parentCode: '7000' },
  { code: '7230', name: 'Gain/Loss on Disposal',             rootType: 'EXPENSE',   accountType: null,                 isGroup: false, parentCode: '7000' },

  // ═══════════════════════════════════════════════════════════════════════════
  // 8000 — TAX
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '8000', name: 'Tax',                               rootType: 'EXPENSE',   accountType: null,                 isGroup: true,  parentCode: null },
  { code: '8110', name: 'Company Income Tax',                rootType: 'EXPENSE',   accountType: 'TAX',                isGroup: false, parentCode: '8000' },
  { code: '8120', name: 'Deferred Tax',                      rootType: 'EXPENSE',   accountType: 'TAX',                isGroup: false, parentCode: '8000' },
];

// ─── Account Code Constants ──────────────────────────────────────────────────
// Central reference for all hardcoded account lookups in the auto-posting
// engine. Import these instead of raw strings so a rename is a single edit.

export const ACCT = {
  // Assets
  CASH_ON_HAND:           '1111',
  BANK_PRIMARY:           '1112',
  AR_CUSTOMERS:           '1121',
  STOCK_FINISHED_GOODS:   '1131',
  STOCK_IN_TRANSIT:       '1132',
  STOCK_WITH_AGENTS:      '1133',
  VAT_INPUT_CREDIT:       '1151',
  /** Consolidated accumulated depreciation contra-asset (was per-category before chart slim-down). */
  ACC_DEPRECIATION:       '1221',

  // Liabilities
  AP_SUPPLIERS:           '2111',
  AP_AGENT_COMMISSIONS:   '2112',
  ACCRUED_SALARIES:       '2121',
  ACCRUED_LOGISTICS:      '2122',
  VAT_OUTPUT:             '2141',
  WHT_PAYABLE:            '2142',
  PAYE_PAYABLE:           '2143',
  PENSION_PAYABLE:        '2144',
  CUSTOMER_DEPOSITS:      '2150',

  // Equity
  SHARE_CAPITAL:          '3110',
  RETAINED_EARNINGS_BF:   '3210',
  CURRENT_YEAR_PL:        '3220',
  OPENING_BALANCE_EQUITY: '3900',

  // Revenue
  PRODUCT_SALES:          '4110',
  SERVICE_REVENUE:        '4120',
  DELIVERY_CHARGES:       '4210',

  // COGS
  COGS_PURCHASE:          '5110',
  COGS_INBOUND_LOGISTICS: '5120',
  COGS_OFFLOADING:        '5130',
  COGS_IMPORT_DUTIES:     '5140',
  CLOSER_COMMISSIONS:     '5210',
  AGENT_DELIVERY_COMM:    '5220',

  // Operating Expenses
  STAFF_SALARIES:         '6110',
  AD_SPEND_DIGITAL:       '6210',
  OUTBOUND_DELIVERY:      '6310',
  DEPRECIATION_FIXED:     '6510',
  BANK_CHARGES:           '6630',
  MISC_EXPENSES:          '6900',
  ROUND_OFF:              '6910',
  STOCK_ADJUSTMENT:       '6930',

  // Other / Finance
  INTEREST_INCOME:        '7110',
  INTEREST_EXPENSE:       '7210',
  DISPOSAL_GAIN_LOSS:     '7230',

  // Tax
  CIT_EXPENSE:            '8110',
  DEFERRED_TAX:           '8120',
} as const;

// ─── GL Mapping Keys ────────────────────────────────────────────────────────
// Each key corresponds to a semantic posting target used by the auto-posting
// engine. Companies can override these defaults via `gl_account_mappings`.

export const GL_MAPPING_KEYS = {
  BANK_PRIMARY: { key: 'BANK_PRIMARY', label: 'Primary Bank Account', defaultCode: '1112', category: 'Assets' },
  AR_CUSTOMERS: { key: 'AR_CUSTOMERS', label: 'Accounts Receivable', defaultCode: '1121', category: 'Assets' },
  STOCK_FINISHED_GOODS: { key: 'STOCK_FINISHED_GOODS', label: 'Finished Goods Stock', defaultCode: '1131', category: 'Assets' },
  VAT_INPUT_CREDIT: { key: 'VAT_INPUT_CREDIT', label: 'VAT Input Credit', defaultCode: '1151', category: 'Assets' },
  ACC_DEPRECIATION: { key: 'ACC_DEPRECIATION', label: 'Accumulated Depreciation', defaultCode: '1221', category: 'Assets' },
  AP_SUPPLIERS: { key: 'AP_SUPPLIERS', label: 'Accounts Payable (Suppliers)', defaultCode: '2111', category: 'Liabilities' },
  AP_AGENT_COMMISSIONS: { key: 'AP_AGENT_COMMISSIONS', label: 'Agent Commissions Payable', defaultCode: '2112', category: 'Liabilities' },
  ACCRUED_SALARIES: { key: 'ACCRUED_SALARIES', label: 'Accrued Salaries', defaultCode: '2121', category: 'Liabilities' },
  VAT_OUTPUT: { key: 'VAT_OUTPUT', label: 'VAT Payable', defaultCode: '2141', category: 'Liabilities' },
  WHT_PAYABLE: { key: 'WHT_PAYABLE', label: 'Withholding Tax Payable', defaultCode: '2142', category: 'Liabilities' },
  PAYE_PAYABLE: { key: 'PAYE_PAYABLE', label: 'PAYE Tax Payable', defaultCode: '2143', category: 'Liabilities' },
  CUSTOMER_DEPOSITS: { key: 'CUSTOMER_DEPOSITS', label: 'Customer Deposits', defaultCode: '2150', category: 'Liabilities' },
  OPENING_BALANCE_EQUITY: { key: 'OPENING_BALANCE_EQUITY', label: 'Opening Balance Equity', defaultCode: '3900', category: 'Equity' },
  PRODUCT_SALES: { key: 'PRODUCT_SALES', label: 'Product Sales Revenue', defaultCode: '4110', category: 'Revenue' },
  COGS_PURCHASE: { key: 'COGS_PURCHASE', label: 'Cost of Goods Sold', defaultCode: '5110', category: 'Cost of Sales' },
  AGENT_DELIVERY_COMM: { key: 'AGENT_DELIVERY_COMM', label: 'Agent Delivery Commission', defaultCode: '5220', category: 'Cost of Sales' },
  STAFF_SALARIES: { key: 'STAFF_SALARIES', label: 'Staff Salaries', defaultCode: '6110', category: 'Expenses' },
  AD_SPEND_DIGITAL: { key: 'AD_SPEND_DIGITAL', label: 'Digital Advertising Spend', defaultCode: '6210', category: 'Expenses' },
  OUTBOUND_DELIVERY: { key: 'OUTBOUND_DELIVERY', label: 'Outbound Delivery Costs', defaultCode: '6310', category: 'Expenses' },
  DEPRECIATION_FIXED: { key: 'DEPRECIATION_FIXED', label: 'Depreciation Expense', defaultCode: '6510', category: 'Expenses' },
  BANK_CHARGES: { key: 'BANK_CHARGES', label: 'Bank Charges', defaultCode: '6630', category: 'Expenses' },
  DISPOSAL_GAIN_LOSS: { key: 'DISPOSAL_GAIN_LOSS', label: 'Gain/Loss on Disposal', defaultCode: '7230', category: 'Other' },
} as const;

export type GlMappingKey = keyof typeof GL_MAPPING_KEYS;

/**
 * Mapping from legacy ERPNext account codes to new 4-digit IFRS codes.
 * Used by the migration to update existing gl_entries and account references.
 */
export const LEGACY_TO_IFRS_CODE: Record<string, string> = {
  // Assets
  'Application of Funds (Assets)': '1000',
  'Current Assets':                '1000',
  'Bank Accounts':                 '1112',
  'First Bank':                    '1112',
  'FCMB':                          '1112',
  'Cash In Hand':                  '1111',
  'Cash':                          '1111',
  'Accounts Receivable':           '1121',
  'Debtors':                       '1121',
  'Stock Assets':                  '1131',
  'Stock In Hand':                 '1131',
  'Tax Assets':                    '1151',
  'Loans and Advances (Assets)':   '1000',
  'Employee Advances':             '1000',
  'Securities and Deposits':       '1000',
  'Earnest Money':                 '1000',
  'Fixed Assets':                  '1000',
  'Buildings':                     '1000',
  'Capital Equipments':            '1000',
  'Electronic Equipments':         '1000',
  'Furnitures and Fixtures':       '1000',
  'Office Equipments':             '1000',
  'Plants and Machineries':        '1000',
  'Softwares':                     '1000',
  'Accumulated Depreciation':      '1221',
  'CWIP Account':                  '1000',
  'Investments':                   '1000',
  'Temporary Accounts':            '1000',
  'Temporary Opening':             '1000',

  // Liabilities
  'Source of Funds (Liabilities)': '2000',
  'Current Liabilities':           '2000',
  'Accounts Payable':              '2111',
  'Creditors':                     '2111',
  'Payroll Payable':               '2121',
  'Stock Liabilities':             '2000',
  'Stock Received But Not Billed': '2122',
  'Asset Received But Not Billed': '2122',
  'Duties and Taxes':              '2141',
  'VAT':                           '2141',
  'PAYE Tax':                      '2143',
  'Pension Payable':               '2144',
  'Loans (Liabilities)':           '2000',
  'Secured Loans':                 '2000',
  'Unsecured Loans':               '2000',
  'Bank Overdraft Account':        '2000',

  // Equity
  'Equity':                        '3000',
  'Capital Stock':                 '3110',
  'Dividends Paid':                '3000',
  'Opening Balance Equity':        '3900',
  'Retained Earnings':             '3210',
  'Revaluation Surplus':           '3000',

  // Income
  'Income':                        '4000',
  'Direct Income':                 '4110',
  'Sale':                          '4110',
  'Service':                       '4120',
  'Indirect Income':               '4210',

  // Expenses
  'Expenses':                      '6000',
  'Direct Expenses':               '5000',
  'Stock Expenses':                '5110',
  'Cost of Goods Sold':            '5110',
  'Expenses Included In Asset Valuation': '5130',
  'Expenses Included In Valuation': '5130',
  'Stock Adjustment':              '6930',
  'Indirect Expenses':             '6000',
  'Administrative Expenses':       '6000',
  'Commission on Sales':           '5210',
  'Delivery Fees':                 '6310',
  'Discount Fees':                 '6630',
  'Depreciation':                  '6510',
  'Entertainment Expenses':        '6900',
  'Exchange Gain/Loss':            '7230',
  'Freight and Forwarding Charges': '6310',
  'Gain/Loss on Asset Disposal':   '7230',
  'Impairment':                    '6900',
  'Internet Expense':              '6900',
  'Legal Expenses':                '6900',
  'Marketing Expenses':            '6210',
  'Miscellaneous Expenses':        '6900',
  'Office Maintenance Expenses':   '6900',
  'Office Rent':                   '6900',
  'Postal Expenses':               '6900',
  'Print and Stationery':          '6900',
  'Round Off':                     '6910',
  'Salary':                        '6110',
  'Sales Expenses':                '6900',
  'Telephone Expenses':            '6900',
  'Travel Expenses':               '6900',
  'Utility Expenses':              '6900',
  'Write Off':                     '6900',
  'WHT Payable':                   '2142',
};
