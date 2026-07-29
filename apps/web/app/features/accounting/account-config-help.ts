/** Plain-language help for Account Config mappings and posting rules. */

export const MAPPING_HELP: Record<string, string> = {
  CASH_PETTY:
    'Cash on hand or petty cash float. Used when cash moves outside the main bank account.',
  BANK_PRIMARY:
    'Company operating bank account for auto-posting. Cash remittances, supplier payments, commissions, and funding hit this account unless remapped.',
  BANK_SECONDARY:
    'Optional second bank account. Map here if you keep a separate float or settlement bank.',
  AR_CUSTOMERS:
    'Customer receivables. Debited when orders are invoiced, credited when remittances clear those debts.',
  STOCK_FINISHED_GOODS:
    'Finished goods inventory. Debited on purchase receipt, credited when COGS is posted on delivery.',
  VAT_INPUT_CREDIT:
    'VAT reclaimable on supplier purchases. Debited when stock is received with recoverable VAT.',
  ACC_DEPRECIATION:
    'Contra-asset for accumulated depreciation on fixed assets. Credited by the monthly depreciation run.',
  AP_SUPPLIERS:
    'Amounts owed to suppliers. Credited on purchase receipt, debited when supplier invoices are paid.',
  AP_AGENT_COMMISSIONS:
    'Commissions owed to delivery agents. Credited when commission is earned, debited when paid out.',
  ACCRUED_SALARIES:
    'Salaries accrued but not yet paid. Credited when payroll is posted, cleared when staff are paid.',
  VAT_OUTPUT:
    'VAT collected on sales. Credited when sales invoices are posted.',
  WHT_PAYABLE:
    'Withholding tax deducted from agent commissions and similar payments, waiting to be remitted.',
  PAYE_PAYABLE:
    'PAYE tax deducted from staff salaries, waiting to be remitted to tax authorities.',
  CUSTOMER_DEPOSITS:
    'Customer money held as deposits before delivery. Credited when a deposit is received.',
  OPENING_BALANCE_EQUITY:
    'Balancing equity used when seeding opening balances. Rarely touched after go-live.',
  PRODUCT_SALES:
    'Product sales revenue. Credited when delivered orders are invoiced.',
  COGS_PURCHASE:
    'Cost of goods sold at FIFO landed cost. Debited when an order is delivered.',
  AGENT_DELIVERY_COMM:
    'Delivery agent commission expense. Debited when commission is earned on a delivery.',
  STAFF_SALARIES:
    'Gross staff salary expense. Debited when a payroll batch is marked paid.',
  AD_SPEND_DIGITAL:
    'Digital advertising spend. Debited when marketing funding is disbursed to a media buyer.',
  OUTBOUND_DELIVERY:
    'Delivery fees and outbound logistics costs taken from remittances. Debited when remittance fees are posted.',
  DEPRECIATION_FIXED:
    'Depreciation expense for fixed assets. Debited by the monthly depreciation run.',
  BANK_CHARGES:
    'Bank charges and other remittance fees that are not delivery fees. Debited when those fees are posted on remittance.',
  DISPOSAL_GAIN_LOSS:
    'Gain or loss when a fixed asset is sold or written off. Debit for loss, credit for gain.',
};

export const STAT_HELP = {
  custom:
    'Custom mappings point at a different GL account than the seeded default code. They still post correctly as long as the mapped account exists.',
  unmapped:
    'These posting keys have no GL account linked. Auto-posting for those flows will fail until you pick an account and save.',
  default:
    'Default mappings still use the seeded chart account for that key. Change the selector only if your chart uses a different account.',
} as const;

export const RULE_HELP: Record<
  string,
  {
    summary: string;
    entries: Record<string, string>;
    /** Ordered detail blocks for the rule-level info modal. */
    sections?: Array<{ heading: string; body: string }>;
  }
> = {
  'Cash Remittance': {
    summary:
      'Posted when a delivery remittance is marked received. The journal splits the settlement into cash banked, delivery fees, other fees, and clearing of customer AR.',
    entries: {
      BANK_PRIMARY:
        'DR Primary Bank Account (BANK_PRIMARY)\n\nThis is the cash that actually lands in the company bank.\n\nFormula: remitted order totals minus delivery fees minus other fees.\n\nExample: if customers owed ₦100,000, delivery fees were ₦5,000, and bank/other fees were ₦1,000, the bank is debited ₦94,000.\n\nIf the net cash banked is zero (fees ate the whole remittance), this line is omitted so the journal still balances.',
      AR_CUSTOMERS:
        'CR Accounts Receivable (AR_CUSTOMERS)\n\nThis clears the customer debt created earlier when the order was delivered and invoiced (Sales Invoice posted DR AR).\n\nEach remitted order credits AR for that order amount. After this posts, those customers no longer show as owing for the remitted invoices.\n\nThis credit is the main balancing side of the remittance journal.',
      OUTBOUND_DELIVERY:
        'DR Outbound Delivery Costs (OUTBOUND_DELIVERY)\n\nThis records delivery / logistics fees withheld from the remittance as an expense.\n\nOnly posted when delivery fees on the remittance are greater than zero. If there are no delivery fees, this line is skipped.\n\nIf the mapped account is missing, the fee amount is left in the bank figure instead so money is never silently dropped.',
      BANK_CHARGES:
        'DR Bank Charges (BANK_CHARGES)\n\nThis records other remittance deductions that are not delivery fees (for example bank charges, discounts, or misc fees captured on the remittance).\n\nOnly posted when those other fees are greater than zero.\n\nSame safety rule: if this mapping is missing, the amount stays in cash banked so the entry still balances.',
    },
    sections: [
      {
        heading: 'When it posts',
        body: 'Auto-posts when a delivery remittance is marked received. Remittances do not carry a bank picker, so cash always hits the mapped Primary Bank Account.',
      },
      {
        heading: 'DR · Primary Bank Account (BANK_PRIMARY)',
        body: 'Cash actually banked after fees. Amount = remitted AR total − delivery fees − other fees. Omitted if net cash is zero.',
      },
      {
        heading: 'CR · Accounts Receivable (AR_CUSTOMERS)',
        body: 'Clears customer receivables for each remitted order. This reverses the AR created when the sale was invoiced.',
      },
      {
        heading: 'DR · Outbound Delivery Costs (OUTBOUND_DELIVERY)',
        body: 'Delivery fee portion of the remittance, posted as expense. Skipped when delivery fees are ₦0.',
      },
      {
        heading: 'DR · Bank Charges (BANK_CHARGES)',
        body: 'Other non-delivery fees on the remittance (charges, discounts, misc). Skipped when those fees are ₦0.',
      },
      {
        heading: 'Why three debits can appear',
        body: 'One remittance can split into bank cash + delivery expense + other fee expense, all balanced by one AR credit (or several AR credit lines per order).',
      },
    ],
  },
  'Sales Invoice': {
    summary:
      'Posted when an order is delivered and invoiced. Recognises revenue and VAT, then moves stock cost into COGS.',
    entries: {
      AR_CUSTOMERS:
        'DR Accounts Receivable (AR_CUSTOMERS)\n\nThe customer now owes the invoice total. This debt is later cleared when cash remittance is received (CR AR).',
      PRODUCT_SALES:
        'CR Product Sales Revenue (PRODUCT_SALES)\n\nRecognises product revenue for the sale (typically exclusive of VAT).',
      VAT_OUTPUT:
        'CR VAT Payable (VAT_OUTPUT)\n\nVAT collected on the sale, held until remitted to tax authorities.',
      COGS_PURCHASE:
        'DR Cost of Goods Sold (COGS_PURCHASE)\n\nFIFO landed cost of the units sold. Moves cost from inventory into expense.',
      STOCK_FINISHED_GOODS:
        'CR Finished Goods Stock (STOCK_FINISHED_GOODS)\n\nReduces inventory by the same landed cost that hit COGS.',
    },
    sections: [
      {
        heading: 'When it posts',
        body: 'When an order is delivered and invoiced.',
      },
      {
        heading: 'DR · Accounts Receivable (AR_CUSTOMERS)',
        body: 'Customer owes the invoice total until remittance clears it.',
      },
      {
        heading: 'CR · Product Sales Revenue (PRODUCT_SALES)',
        body: 'Product revenue recognised on delivery/invoice.',
      },
      {
        heading: 'CR · VAT Payable (VAT_OUTPUT)',
        body: 'VAT collected on the sale.',
      },
      {
        heading: 'DR · Cost of Goods Sold (COGS_PURCHASE)',
        body: 'FIFO landed cost of units sold.',
      },
      {
        heading: 'CR · Finished Goods Stock (STOCK_FINISHED_GOODS)',
        body: 'Inventory reduced at the same landed cost.',
      },
    ],
  },
  'Payroll Batch': {
    summary: 'Posted when a payroll batch is marked paid. Records salary expense and related payables.',
    entries: {
      STAFF_SALARIES:
        'DR Staff Salaries (STAFF_SALARIES)\n\nGross salary expense for everyone in the paid payroll batch.',
      ACCRUED_SALARIES:
        'CR Accrued Salaries (ACCRUED_SALARIES)\n\nNet pay owed to staff after statutory deductions.',
      PAYE_PAYABLE:
        'CR PAYE Tax Payable (PAYE_PAYABLE)\n\nPAYE withheld from staff pay, waiting remittance to tax authorities.',
    },
    sections: [
      { heading: 'When it posts', body: 'When a payroll batch is marked paid.' },
      { heading: 'DR · Staff Salaries (STAFF_SALARIES)', body: 'Gross salary expense for the batch.' },
      { heading: 'CR · Accrued Salaries (ACCRUED_SALARIES)', body: 'Net pay owed to staff.' },
      { heading: 'CR · PAYE Tax Payable (PAYE_PAYABLE)', body: 'PAYE withheld from staff pay.' },
    ],
  },
  'Purchase Receipt': {
    summary:
      'Posted when inbound stock is verified. Capitalises finished goods (and VAT input when applicable) against supplier payable.',
    entries: {
      STOCK_FINISHED_GOODS:
        'DR Finished Goods Stock (STOCK_FINISHED_GOODS)\n\nLanded value of stock received (factory cost plus allocated landing costs).',
      VAT_INPUT_CREDIT:
        'DR VAT Input Credit (VAT_INPUT_CREDIT)\n\nRecoverable VAT on the purchase, when present.',
      AP_SUPPLIERS:
        'CR Accounts Payable (AP_SUPPLIERS)\n\nAmount owed to the supplier for the receipt.',
    },
    sections: [
      { heading: 'When it posts', body: 'When inbound stock is verified from a supplier shipment.' },
      { heading: 'DR · Finished Goods Stock (STOCK_FINISHED_GOODS)', body: 'Landed stock value capitalised.' },
      { heading: 'DR · VAT Input Credit (VAT_INPUT_CREDIT)', body: 'Recoverable VAT, when present.' },
      { heading: 'CR · Accounts Payable (AP_SUPPLIERS)', body: 'Supplier payable opened.' },
    ],
  },
  'Supplier Payment': {
    summary: 'Posted when a supplier invoice is paid from the bank.',
    entries: {
      AP_SUPPLIERS:
        'DR Accounts Payable (AP_SUPPLIERS)\n\nClears the supplier payable that was opened on purchase receipt.',
      BANK_PRIMARY:
        'CR Primary Bank Account (BANK_PRIMARY)\n\nCash leaves the operating bank to pay the supplier.',
    },
    sections: [
      { heading: 'When it posts', body: 'When a supplier invoice is paid.' },
      { heading: 'DR · Accounts Payable (AP_SUPPLIERS)', body: 'Clears supplier payable.' },
      { heading: 'CR · Primary Bank Account (BANK_PRIMARY)', body: 'Cash paid from the bank.' },
    ],
  },
  'Agent Commission Due': {
    summary: 'Posted when a delivery agent earns commission.',
    entries: {
      AGENT_DELIVERY_COMM:
        'DR Agent Delivery Commission (AGENT_DELIVERY_COMM)\n\nCommission expense earned on the delivery.',
      AP_AGENT_COMMISSIONS:
        'CR Agent Commissions Payable (AP_AGENT_COMMISSIONS)\n\nAmount owed to the agent until it is paid out.',
    },
    sections: [
      { heading: 'When it posts', body: 'When a delivery agent earns commission.' },
      { heading: 'DR · Agent Delivery Commission (AGENT_DELIVERY_COMM)', body: 'Commission expense.' },
      { heading: 'CR · Agent Commissions Payable (AP_AGENT_COMMISSIONS)', body: 'Payable to the agent.' },
    ],
  },
  'Agent Commission Paid': {
    summary: 'Posted when agent commission is disbursed from the bank.',
    entries: {
      AP_AGENT_COMMISSIONS:
        'DR Agent Commissions Payable (AP_AGENT_COMMISSIONS)\n\nClears the commission payable.',
      BANK_PRIMARY:
        'CR Primary Bank Account (BANK_PRIMARY)\n\nNet cash paid to the agent from the bank.',
      WHT_PAYABLE:
        'CR Withholding Tax Payable (WHT_PAYABLE)\n\nWHT deducted from the payout, when applicable.',
    },
    sections: [
      { heading: 'When it posts', body: 'When agent commission is disbursed.' },
      { heading: 'DR · Agent Commissions Payable (AP_AGENT_COMMISSIONS)', body: 'Clears commission payable.' },
      { heading: 'CR · Primary Bank Account (BANK_PRIMARY)', body: 'Net cash paid from bank.' },
      { heading: 'CR · Withholding Tax Payable (WHT_PAYABLE)', body: 'WHT withheld, when applicable.' },
    ],
  },
  'Marketing Funding': {
    summary: 'Posted when ad spend is disbursed to a media buyer.',
    entries: {
      AD_SPEND_DIGITAL:
        'DR Digital Advertising Spend (AD_SPEND_DIGITAL)\n\nAdvertising expense for the funding disbursement.',
      BANK_PRIMARY:
        'CR Primary Bank Account (BANK_PRIMARY)\n\nCash leaves the bank to fund the media buyer.',
    },
    sections: [
      { heading: 'When it posts', body: 'When ad spend is disbursed to a media buyer.' },
      { heading: 'DR · Digital Advertising Spend (AD_SPEND_DIGITAL)', body: 'Ad spend expense.' },
      { heading: 'CR · Primary Bank Account (BANK_PRIMARY)', body: 'Cash paid from bank.' },
    ],
  },
  'Expense Approval': {
    summary:
      'Posted when an expense submission is approved. Debits the GL account chosen on the expense, credits supplier payable.',
    entries: {
      '(Selected GL Account)':
        'DR (Selected GL Account)\n\nThe expense or asset account picked on the expense form.',
      AP_SUPPLIERS:
        'CR Accounts Payable (AP_SUPPLIERS)\n\nAmount owed for the approved expense.',
    },
    sections: [
      { heading: 'When it posts', body: 'When an expense submission is approved.' },
      { heading: 'DR · (Selected GL Account)', body: 'Account chosen on the expense form.' },
      { heading: 'CR · Accounts Payable (AP_SUPPLIERS)', body: 'Payable for the approved expense.' },
    ],
  },
  'Asset Acquisition': {
    summary: 'Posted when a fixed asset is purchased.',
    entries: {
      '(Asset Account)':
        'DR (Asset Account)\n\nThe fixed asset account for the purchased asset.',
      BANK_PRIMARY:
        'CR Primary Bank Account (BANK_PRIMARY)\n\nCash paid for the asset from the primary bank.',
    },
    sections: [
      { heading: 'When it posts', body: 'When a fixed asset is purchased.' },
      { heading: 'DR · (Asset Account)', body: 'Capitalises the asset.' },
      { heading: 'CR · Primary Bank Account (BANK_PRIMARY)', body: 'Cash paid from bank.' },
    ],
  },
  'Monthly Depreciation': {
    summary: 'Posted when depreciation is run for a period.',
    entries: {
      DEPRECIATION_FIXED:
        'DR Depreciation Expense (DEPRECIATION_FIXED)\n\nDepreciation expense for the period.',
      ACC_DEPRECIATION:
        'CR Accumulated Depreciation (ACC_DEPRECIATION)\n\nAccumulates depreciation against the asset.',
    },
    sections: [
      { heading: 'When it posts', body: 'When depreciation is run for a period.' },
      { heading: 'DR · Depreciation Expense (DEPRECIATION_FIXED)', body: 'Period depreciation expense.' },
      { heading: 'CR · Accumulated Depreciation (ACC_DEPRECIATION)', body: 'Contra-asset accumulates.' },
    ],
  },
  'Asset Disposal': {
    summary:
      'Posted when a fixed asset is sold or written off. Removes the asset and accumulated depreciation, records cash and any gain or loss.',
    entries: {
      BANK_PRIMARY:
        'DR Primary Bank Account (BANK_PRIMARY)\n\nSale proceeds received, when the asset is sold for cash.',
      ACC_DEPRECIATION:
        'DR Accumulated Depreciation (ACC_DEPRECIATION)\n\nClears accumulated depreciation on the disposed asset.',
      '(Asset Account)':
        'CR (Asset Account)\n\nRemoves the original asset cost from the books.',
      DISPOSAL_GAIN_LOSS:
        'DR/CR Gain/Loss on Disposal (DISPOSAL_GAIN_LOSS)\n\nDebit for a loss, credit for a gain, so the disposal entry balances.',
    },
    sections: [
      { heading: 'When it posts', body: 'When a fixed asset is sold or written off.' },
      { heading: 'DR · Primary Bank Account (BANK_PRIMARY)', body: 'Cash proceeds, if sold for cash.' },
      { heading: 'DR · Accumulated Depreciation (ACC_DEPRECIATION)', body: 'Clears accumulated depreciation.' },
      { heading: 'CR · (Asset Account)', body: 'Removes asset cost.' },
      { heading: 'DR/CR · Gain/Loss on Disposal (DISPOSAL_GAIN_LOSS)', body: 'Balancing gain or loss.' },
    ],
  },
  'Customer Deposit': {
    summary: 'Posted when a customer pays a deposit upfront.',
    entries: {
      BANK_PRIMARY:
        'DR Primary Bank Account (BANK_PRIMARY)\n\nDeposit cash received into the bank.',
      CUSTOMER_DEPOSITS:
        'CR Customer Deposits (CUSTOMER_DEPOSITS)\n\nLiability until the deposit is applied to an order.',
    },
    sections: [
      { heading: 'When it posts', body: 'When a customer pays a deposit upfront.' },
      { heading: 'DR · Primary Bank Account (BANK_PRIMARY)', body: 'Deposit cash received.' },
      { heading: 'CR · Customer Deposits (CUSTOMER_DEPOSITS)', body: 'Liability until applied.' },
    ],
  },
};

export const SIDE_HELP = {
  DR: 'Debit increases assets and expenses, and decreases liabilities, equity, and revenue.',
  CR: 'Credit increases liabilities, equity, and revenue, and decreases assets and expenses.',
  'DR/CR': 'Side depends on whether the result is a gain (credit) or a loss (debit).',
} as const;

export const ACCOUNT_TYPES_HELP =
  'Account types tag leaf accounts for reports and cash flow (for example BANK and CASH). They are not posting keys. Add accounts on the Accounts tab to introduce more of a type.';

export const POSTING_RULES_INTRO_HELP =
  'These rules show how auto-posting journals are built. Named accounts link to mapping keys: change the linked GL account on the Mappings tab.';
