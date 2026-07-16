/**
 * Default Chart of Accounts — Nigerian IFRS-compliant 4-digit numeric structure.
 *
 * Follows FRCN-adopted IFRS conventions:
 *   1000s = Assets, 2000s = Liabilities, 3000s = Equity,
 *   4000s = Revenue, 5000s = Cost of Sales, 6000s = Operating Expenses,
 *   7000s = Other Income/Finance Costs, 8000s = Tax.
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
 * IFRS-compliant Nigerian Chart of Accounts — 4-digit numeric structure.
 * Aligned with FRCN, CAMA 2020, and FIRS requirements.
 */
export const DEFAULT_CHART_OF_ACCOUNTS: ChartOfAccountsEntry[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // 1000 — ASSETS
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '1000', name: 'Assets',                                rootType: 'ASSET',     accountType: null,                          isGroup: true,  parentCode: null },

  // ── 1100 Current Assets ────────────────────────────────────────────────────
  { code: '1100', name: 'Current Assets',                        rootType: 'ASSET',     accountType: null,                          isGroup: true,  parentCode: '1000' },

  { code: '1110', name: 'Cash and Cash Equivalents',             rootType: 'ASSET',     accountType: null,                          isGroup: true,  parentCode: '1100' },
  { code: '1111', name: 'Cash on Hand (Petty Cash)',             rootType: 'ASSET',     accountType: 'CASH',                        isGroup: false, parentCode: '1110' },
  { code: '1112', name: 'Cash at Bank — Primary Account',       rootType: 'ASSET',     accountType: 'BANK',                        isGroup: false, parentCode: '1110' },
  { code: '1113', name: 'Cash at Bank — Secondary Account',     rootType: 'ASSET',     accountType: 'BANK',                        isGroup: false, parentCode: '1110' },

  { code: '1120', name: 'Accounts Receivable (Trade Debtors)',   rootType: 'ASSET',     accountType: null,                          isGroup: true,  parentCode: '1100' },
  { code: '1121', name: 'Accounts Receivable — Customers',      rootType: 'ASSET',     accountType: 'RECEIVABLE',                  isGroup: false, parentCode: '1120' },
  { code: '1122', name: 'Provision for Bad & Doubtful Debts',    rootType: 'ASSET',     accountType: null,                          isGroup: false, parentCode: '1120' },

  { code: '1130', name: 'Inventory',                             rootType: 'ASSET',     accountType: null,                          isGroup: true,  parentCode: '1100' },
  { code: '1131', name: 'Finished Goods — Stock',                rootType: 'ASSET',     accountType: 'STOCK',                       isGroup: false, parentCode: '1130' },
  { code: '1132', name: 'Goods in Transit',                      rootType: 'ASSET',     accountType: 'STOCK',                       isGroup: false, parentCode: '1130' },
  { code: '1133', name: 'Stock Held by Agents',                  rootType: 'ASSET',     accountType: 'STOCK',                       isGroup: false, parentCode: '1130' },

  { code: '1140', name: 'Prepayments & Deposits',                rootType: 'ASSET',     accountType: null,                          isGroup: true,  parentCode: '1100' },
  { code: '1141', name: 'Prepaid Expenses',                      rootType: 'ASSET',     accountType: null,                          isGroup: false, parentCode: '1140' },
  { code: '1142', name: 'Staff Advances & Loans',                rootType: 'ASSET',     accountType: null,                          isGroup: false, parentCode: '1140' },

  { code: '1150', name: 'Other Current Assets',                  rootType: 'ASSET',     accountType: null,                          isGroup: true,  parentCode: '1100' },
  { code: '1151', name: 'VAT Input Credit (Recoverable)',        rootType: 'ASSET',     accountType: 'TAX',                         isGroup: false, parentCode: '1150' },
  { code: '1152', name: 'WHT Receivable',                        rootType: 'ASSET',     accountType: 'TAX',                         isGroup: false, parentCode: '1150' },

  // ── 1200 Non-Current Assets ────────────────────────────────────────────────
  { code: '1200', name: 'Non-Current Assets',                    rootType: 'ASSET',     accountType: null,                          isGroup: true,  parentCode: '1000' },

  { code: '1210', name: 'Property, Plant & Equipment (PPE)',     rootType: 'ASSET',     accountType: null,                          isGroup: true,  parentCode: '1200' },
  { code: '1211', name: 'Land & Buildings',                      rootType: 'ASSET',     accountType: 'FIXED_ASSET',                 isGroup: false, parentCode: '1210' },
  { code: '1212', name: 'Motor Vehicles',                        rootType: 'ASSET',     accountType: 'FIXED_ASSET',                 isGroup: false, parentCode: '1210' },
  { code: '1213', name: 'Computers & IT Equipment',              rootType: 'ASSET',     accountType: 'FIXED_ASSET',                 isGroup: false, parentCode: '1210' },
  { code: '1214', name: 'Furniture & Fittings',                  rootType: 'ASSET',     accountType: 'FIXED_ASSET',                 isGroup: false, parentCode: '1210' },
  { code: '1215', name: 'Plant & Machinery',                     rootType: 'ASSET',     accountType: 'FIXED_ASSET',                 isGroup: false, parentCode: '1210' },
  { code: '1219', name: 'Capital Work in Progress (CWIP)',       rootType: 'ASSET',     accountType: 'FIXED_ASSET',                 isGroup: false, parentCode: '1210' },

  { code: '1220', name: 'Accumulated Depreciation (Contra)',     rootType: 'ASSET',     accountType: null,                          isGroup: true,  parentCode: '1200' },
  { code: '1221', name: 'Acc. Dep. — Motor Vehicles',           rootType: 'ASSET',     accountType: 'DEPRECIATION',                isGroup: false, parentCode: '1220' },
  { code: '1222', name: 'Acc. Dep. — Computers & IT',           rootType: 'ASSET',     accountType: 'DEPRECIATION',                isGroup: false, parentCode: '1220' },
  { code: '1223', name: 'Acc. Dep. — Furniture & Fittings',     rootType: 'ASSET',     accountType: 'DEPRECIATION',                isGroup: false, parentCode: '1220' },

  { code: '1230', name: 'Intangible Assets',                     rootType: 'ASSET',     accountType: null,                          isGroup: true,  parentCode: '1200' },
  { code: '1231', name: 'Software Licences & Platform Costs',    rootType: 'ASSET',     accountType: 'FIXED_ASSET',                 isGroup: false, parentCode: '1230' },
  { code: '1232', name: 'Acc. Amortisation — Software',         rootType: 'ASSET',     accountType: 'DEPRECIATION',                isGroup: false, parentCode: '1230' },

  // ═══════════════════════════════════════════════════════════════════════════
  // 2000 — LIABILITIES
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '2000', name: 'Liabilities',                            rootType: 'LIABILITY', accountType: null,                          isGroup: true,  parentCode: null },

  // ── 2100 Current Liabilities ───────────────────────────────────────────────
  { code: '2100', name: 'Current Liabilities',                    rootType: 'LIABILITY', accountType: null,                          isGroup: true,  parentCode: '2000' },

  { code: '2110', name: 'Accounts Payable (Trade Creditors)',     rootType: 'LIABILITY', accountType: null,                          isGroup: true,  parentCode: '2100' },
  { code: '2111', name: 'Accounts Payable — Suppliers',          rootType: 'LIABILITY', accountType: 'PAYABLE',                     isGroup: false, parentCode: '2110' },
  { code: '2112', name: 'Accounts Payable — Agent Commissions', rootType: 'LIABILITY', accountType: 'PAYABLE',                     isGroup: false, parentCode: '2110' },

  { code: '2120', name: 'Accrued Expenses',                      rootType: 'LIABILITY', accountType: null,                          isGroup: true,  parentCode: '2100' },
  { code: '2121', name: 'Accrued Salaries & Wages',              rootType: 'LIABILITY', accountType: null,                          isGroup: false, parentCode: '2120' },
  { code: '2122', name: 'Accrued Logistics Costs',               rootType: 'LIABILITY', accountType: null,                          isGroup: false, parentCode: '2120' },

  { code: '2130', name: 'Short-term Borrowings',                 rootType: 'LIABILITY', accountType: null,                          isGroup: false, parentCode: '2100' },

  { code: '2140', name: 'Tax Liabilities',                       rootType: 'LIABILITY', accountType: null,                          isGroup: true,  parentCode: '2100' },
  { code: '2141', name: 'VAT Output (Payable to FIRS)',          rootType: 'LIABILITY', accountType: 'TAX',                         isGroup: false, parentCode: '2140' },
  { code: '2142', name: 'Withholding Tax (WHT) Payable',         rootType: 'LIABILITY', accountType: 'TAX',                         isGroup: false, parentCode: '2140' },
  { code: '2143', name: 'PAYE Tax Payable',                      rootType: 'LIABILITY', accountType: 'TAX',                         isGroup: false, parentCode: '2140' },
  { code: '2144', name: 'Pension Contributions Payable',         rootType: 'LIABILITY', accountType: null,                          isGroup: false, parentCode: '2140' },

  { code: '2150', name: 'Customer Deposits & Advance Payments',  rootType: 'LIABILITY', accountType: null,                          isGroup: false, parentCode: '2100' },

  // ── 2200 Non-Current Liabilities ───────────────────────────────────────────
  { code: '2200', name: 'Non-Current Liabilities',                rootType: 'LIABILITY', accountType: null,                          isGroup: true,  parentCode: '2000' },
  { code: '2210', name: 'Long-term Loans',                        rootType: 'LIABILITY', accountType: null,                          isGroup: false, parentCode: '2200' },
  { code: '2220', name: 'Deferred Tax Liability',                 rootType: 'LIABILITY', accountType: null,                          isGroup: false, parentCode: '2200' },

  // ═══════════════════════════════════════════════════════════════════════════
  // 3000 — EQUITY
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '3000', name: 'Equity',                                 rootType: 'EQUITY',    accountType: null,                          isGroup: true,  parentCode: null },

  { code: '3100', name: 'Capital',                                rootType: 'EQUITY',    accountType: null,                          isGroup: true,  parentCode: '3000' },
  { code: '3110', name: 'Ordinary Share Capital',                 rootType: 'EQUITY',    accountType: 'EQUITY',                      isGroup: false, parentCode: '3100' },

  { code: '3200', name: 'Retained Earnings',                     rootType: 'EQUITY',    accountType: null,                          isGroup: true,  parentCode: '3000' },
  { code: '3210', name: 'Retained Profit/(Loss) Brought Forward', rootType: 'EQUITY',   accountType: 'EQUITY',                      isGroup: false, parentCode: '3200' },
  { code: '3220', name: 'Current Year Profit/(Loss)',             rootType: 'EQUITY',    accountType: 'EQUITY',                      isGroup: false, parentCode: '3200' },

  { code: '3300', name: 'Capital & Other Reserves',               rootType: 'EQUITY',    accountType: 'EQUITY',                      isGroup: false, parentCode: '3000' },

  // Opening balance equity — used by the opening balance cutover tool
  { code: '3900', name: 'Opening Balance Equity',                 rootType: 'EQUITY',    accountType: 'EQUITY',                      isGroup: false, parentCode: '3000' },

  // ═══════════════════════════════════════════════════════════════════════════
  // 4000 — REVENUE
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '4000', name: 'Revenue',                                rootType: 'INCOME',    accountType: null,                          isGroup: true,  parentCode: null },

  { code: '4100', name: 'Sales Revenue',                          rootType: 'INCOME',    accountType: null,                          isGroup: true,  parentCode: '4000' },
  { code: '4110', name: 'Product Sales Revenue',                  rootType: 'INCOME',    accountType: 'DIRECT_INCOME',               isGroup: false, parentCode: '4100' },
  { code: '4120', name: 'Service Revenue',                        rootType: 'INCOME',    accountType: 'DIRECT_INCOME',               isGroup: false, parentCode: '4100' },

  { code: '4200', name: 'Other Income',                           rootType: 'INCOME',    accountType: null,                          isGroup: true,  parentCode: '4000' },
  { code: '4210', name: 'Delivery & Handling Charges Billed',     rootType: 'INCOME',    accountType: 'INDIRECT_INCOME',             isGroup: false, parentCode: '4200' },
  { code: '4220', name: 'Interest Income',                        rootType: 'INCOME',    accountType: 'INDIRECT_INCOME',             isGroup: false, parentCode: '4200' },
  { code: '4230', name: 'Gain on Disposal of Assets',             rootType: 'INCOME',    accountType: 'INDIRECT_INCOME',             isGroup: false, parentCode: '4200' },

  // ═══════════════════════════════════════════════════════════════════════════
  // 5000 — COST OF SALES
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '5000', name: 'Cost of Sales',                          rootType: 'EXPENSE',   accountType: null,                          isGroup: true,  parentCode: null },

  { code: '5100', name: 'Cost of Goods Sold (COGS)',              rootType: 'EXPENSE',   accountType: null,                          isGroup: true,  parentCode: '5000' },
  { code: '5110', name: 'Product Purchase Cost',                  rootType: 'EXPENSE',   accountType: 'COST_OF_GOODS_SOLD',          isGroup: false, parentCode: '5100' },
  { code: '5120', name: 'Inbound Logistics Cost (to Warehouse)',  rootType: 'EXPENSE',   accountType: 'COST_OF_GOODS_SOLD',          isGroup: false, parentCode: '5100' },
  { code: '5130', name: 'Offloading & Handling Costs',            rootType: 'EXPENSE',   accountType: 'COST_OF_GOODS_SOLD',          isGroup: false, parentCode: '5100' },
  { code: '5140', name: 'Import Duties & Levies',                 rootType: 'EXPENSE',   accountType: 'COST_OF_GOODS_SOLD',          isGroup: false, parentCode: '5100' },

  { code: '5200', name: 'Direct Operational Costs',               rootType: 'EXPENSE',   accountType: null,                          isGroup: true,  parentCode: '5000' },
  { code: '5210', name: 'Active Closer Commissions',              rootType: 'EXPENSE',   accountType: 'CHARGEABLE',                  isGroup: false, parentCode: '5200' },
  { code: '5220', name: 'Agent Delivery Commission',              rootType: 'EXPENSE',   accountType: 'CHARGEABLE',                  isGroup: false, parentCode: '5200' },

  // ═══════════════════════════════════════════════════════════════════════════
  // 6000 — OPERATING EXPENSES
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '6000', name: 'Operating Expenses',                     rootType: 'EXPENSE',   accountType: null,                          isGroup: true,  parentCode: null },

  { code: '6100', name: 'Salaries & Wages',                       rootType: 'EXPENSE',   accountType: null,                          isGroup: true,  parentCode: '6000' },
  { code: '6110', name: 'Staff Salaries',                         rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '6100' },
  { code: '6120', name: 'Staff Benefits & Allowances',            rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '6100' },
  { code: '6130', name: 'Employer Pension Contributions',         rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '6100' },

  { code: '6200', name: 'Marketing & Advertising',                rootType: 'EXPENSE',   accountType: null,                          isGroup: true,  parentCode: '6000' },
  { code: '6210', name: 'Digital Advertising Spend',              rootType: 'EXPENSE',   accountType: 'CHARGEABLE',                  isGroup: false, parentCode: '6200' },
  { code: '6220', name: 'Traditional Media Spend',                rootType: 'EXPENSE',   accountType: 'CHARGEABLE',                  isGroup: false, parentCode: '6200' },

  { code: '6300', name: 'Logistics & Delivery',                   rootType: 'EXPENSE',   accountType: null,                          isGroup: true,  parentCode: '6000' },
  { code: '6310', name: 'Outbound Delivery Costs',                rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '6300' },
  { code: '6320', name: 'Fuel & Vehicle Running Costs',           rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '6300' },

  { code: '6400', name: 'Occupancy Costs',                        rootType: 'EXPENSE',   accountType: null,                          isGroup: true,  parentCode: '6000' },
  { code: '6410', name: 'Rent Expense',                           rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '6400' },
  { code: '6420', name: 'Electricity & Utilities',                rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '6400' },

  { code: '6500', name: 'Depreciation & Amortisation',            rootType: 'EXPENSE',   accountType: null,                          isGroup: true,  parentCode: '6000' },
  { code: '6510', name: 'Depreciation — Fixed Assets',           rootType: 'EXPENSE',   accountType: 'DEPRECIATION',                isGroup: false, parentCode: '6500' },
  { code: '6520', name: 'Amortisation — Intangibles',            rootType: 'EXPENSE',   accountType: 'DEPRECIATION',                isGroup: false, parentCode: '6500' },

  { code: '6600', name: 'General & Administrative',               rootType: 'EXPENSE',   accountType: null,                          isGroup: true,  parentCode: '6000' },
  { code: '6610', name: 'Office Supplies & Stationery',           rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '6600' },
  { code: '6620', name: 'Internet & Telecommunications',          rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '6600' },
  { code: '6630', name: 'Bank Charges & Transaction Fees',        rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '6600' },
  { code: '6640', name: 'Professional Fees (Legal, Audit, Tax)',   rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '6600' },
  { code: '6650', name: 'Insurance Premiums',                     rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '6600' },
  { code: '6660', name: 'Staff Training & Development',           rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '6600' },
  { code: '6670', name: 'Repairs & Maintenance',                  rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '6600' },

  // Catch-all for misc / round-off / write-off
  { code: '6900', name: 'Miscellaneous Expenses',                 rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '6000' },
  { code: '6910', name: 'Round Off',                              rootType: 'EXPENSE',   accountType: 'ROUND_OFF',                   isGroup: false, parentCode: '6000' },
  { code: '6920', name: 'Write Off',                              rootType: 'EXPENSE',   accountType: null,                          isGroup: false, parentCode: '6000' },
  { code: '6930', name: 'Stock Adjustment',                       rootType: 'EXPENSE',   accountType: null,                          isGroup: false, parentCode: '6000' },

  // ═══════════════════════════════════════════════════════════════════════════
  // 7000 — OTHER INCOME & FINANCE COSTS
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '7000', name: 'Other Income & Finance Costs',           rootType: 'EXPENSE',   accountType: null,                          isGroup: true,  parentCode: null },
  { code: '7110', name: 'Interest Income',                        rootType: 'INCOME',    accountType: 'INDIRECT_INCOME',             isGroup: false, parentCode: '7000' },
  { code: '7210', name: 'Interest Expense on Loans',              rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '7000' },
  { code: '7220', name: 'Bank Loan Arrangement Fees',             rootType: 'EXPENSE',   accountType: 'INDIRECT_EXPENSE',            isGroup: false, parentCode: '7000' },
  { code: '7230', name: 'Gain/Loss on Asset Disposal',            rootType: 'EXPENSE',   accountType: null,                          isGroup: false, parentCode: '7000' },

  // ═══════════════════════════════════════════════════════════════════════════
  // 8000 — TAX
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '8000', name: 'Tax',                                    rootType: 'EXPENSE',   accountType: null,                          isGroup: true,  parentCode: null },
  { code: '8110', name: 'Company Income Tax Expense (CIT)',       rootType: 'EXPENSE',   accountType: 'TAX',                         isGroup: false, parentCode: '8000' },
  { code: '8120', name: 'Deferred Tax Expense/(Credit)',          rootType: 'EXPENSE',   accountType: 'TAX',                         isGroup: false, parentCode: '8000' },

  // ═══════════════════════════════════════════════════════════════════════════
  // Temporary / system accounts
  // ═══════════════════════════════════════════════════════════════════════════
  { code: '9000', name: 'Temporary Accounts',                     rootType: 'ASSET',     accountType: null,                          isGroup: true,  parentCode: null },
  { code: '9100', name: 'Temporary Opening',                      rootType: 'ASSET',     accountType: 'TEMPORARY',                   isGroup: false, parentCode: '9000' },
];

// ─── Account Code Constants ──────────────────────────────────────────────────
// Central reference for all hardcoded account lookups in the auto-posting
// engine. Import these instead of raw strings so a rename is a single edit.

export const ACCT = {
  // Assets
  CASH_ON_HAND:           '1111',
  BANK_PRIMARY:           '1112',
  BANK_SECONDARY:         '1113',
  AR_CUSTOMERS:           '1121',
  BAD_DEBT_PROVISION:     '1122',
  STOCK_FINISHED_GOODS:   '1131',
  STOCK_IN_TRANSIT:       '1132',
  STOCK_WITH_AGENTS:      '1133',
  VAT_INPUT_CREDIT:       '1151',
  WHT_RECEIVABLE:         '1152',
  ACC_DEP_VEHICLES:       '1221',
  ACC_DEP_COMPUTERS:      '1222',
  ACC_DEP_FURNITURE:      '1223',
  ACC_AMORT_SOFTWARE:     '1232',

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
  GAIN_ON_DISPOSAL:       '4230',

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
  AMORTISATION_INTANG:    '6520',
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

/**
 * Mapping from legacy ERPNext account codes to new 4-digit IFRS codes.
 * Used by the migration to update existing gl_entries and account references.
 */
export const LEGACY_TO_IFRS_CODE: Record<string, string> = {
  // Assets
  'Application of Funds (Assets)': '1000',
  'Current Assets':                '1100',
  'Bank Accounts':                 '1110',
  'First Bank':                    '1112',
  'FCMB':                          '1113',
  'Cash In Hand':                  '1110',
  'Cash':                          '1111',
  'Accounts Receivable':           '1120',
  'Debtors':                       '1121',
  'Stock Assets':                  '1130',
  'Stock In Hand':                 '1131',
  'Tax Assets':                    '1150',
  'Loans and Advances (Assets)':   '1140',
  'Employee Advances':             '1142',
  'Securities and Deposits':       '1140',
  'Earnest Money':                 '1141',
  'Fixed Assets':                  '1200',
  'Buildings':                     '1211',
  'Capital Equipments':            '1215',
  'Electronic Equipments':         '1213',
  'Furnitures and Fixtures':       '1214',
  'Office Equipments':             '1213',
  'Plants and Machineries':        '1215',
  'Softwares':                     '1231',
  'Accumulated Depreciation':      '1221',
  'CWIP Account':                  '1219',
  'Investments':                   '1200',
  'Temporary Accounts':            '9000',
  'Temporary Opening':             '9100',

  // Liabilities
  'Source of Funds (Liabilities)': '2000',
  'Current Liabilities':           '2100',
  'Accounts Payable':              '2110',
  'Creditors':                     '2111',
  'Payroll Payable':               '2121',
  'Stock Liabilities':             '2100',
  'Stock Received But Not Billed': '2122',
  'Asset Received But Not Billed': '2122',
  'Duties and Taxes':              '2140',
  'VAT':                           '2141',
  'PAYE Tax':                      '2143',
  'Pension Payable':               '2144',
  'Loans (Liabilities)':           '2200',
  'Secured Loans':                 '2210',
  'Unsecured Loans':               '2210',
  'Bank Overdraft Account':        '2130',

  // Equity
  'Equity':                        '3000',
  'Capital Stock':                 '3110',
  'Dividends Paid':                '3300',
  'Opening Balance Equity':        '3900',
  'Retained Earnings':             '3210',
  'Revaluation Surplus':           '3300',

  // Income
  'Income':                        '4000',
  'Direct Income':                 '4100',
  'Sale':                          '4110',
  'Service':                       '4120',
  'Indirect Income':               '4200',

  // Expenses
  'Expenses':                      '6000',
  'Direct Expenses':               '5000',
  'Stock Expenses':                '5100',
  'Cost of Goods Sold':            '5110',
  'Expenses Included In Asset Valuation': '5130',
  'Expenses Included In Valuation': '5130',
  'Stock Adjustment':              '6930',
  'Indirect Expenses':             '6000',
  'Administrative Expenses':       '6600',
  'Commission on Sales':           '5210',
  'Delivery Fees':                 '6310',
  'Discount Fees':                 '6630',
  'Depreciation':                  '6510',
  'Entertainment Expenses':        '6900',
  'Exchange Gain/Loss':            '7230',
  'Freight and Forwarding Charges': '6310',
  'Gain/Loss on Asset Disposal':   '7230',
  'Impairment':                    '6920',
  'Internet Expense':              '6620',
  'Legal Expenses':                '6640',
  'Marketing Expenses':            '6210',
  'Miscellaneous Expenses':        '6900',
  'Office Maintenance Expenses':   '6670',
  'Office Rent':                   '6410',
  'Postal Expenses':               '6900',
  'Print and Stationery':          '6610',
  'Round Off':                     '6910',
  'Salary':                        '6110',
  'Sales Expenses':                '6900',
  'Telephone Expenses':            '6620',
  'Travel Expenses':               '6900',
  'Utility Expenses':              '6420',
  'Write Off':                     '6920',
  // WHT added by service, not in original CoA
  'WHT Payable':                   '2142',
};
