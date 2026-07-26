#!/usr/bin/env node
/**
 * Seed demo data so every Accounting page has something to show (local/dev).
 *
 * Usage:
 *   node scripts/seed-accounting-demo.mjs
 *
 * Env (optional):
 *   API_URL                     default http://localhost:4444
 *   ACCOUNTING_CHECK_EMAIL      default kbshowkb@gmail.com
 *   ACCOUNTING_CHECK_PASSWORD   default 123456789
 *
 * Safe to re-run: skips steps when "[UAT DEMO]" markers already exist.
 */
import http from 'node:http';

const API = process.env.API_URL?.replace(/\/$/, '') || 'http://localhost:4444';
const EMAIL = process.env.ACCOUNTING_CHECK_EMAIL || 'kbshowkb@gmail.com';
const PASSWORD = process.env.ACCOUNTING_CHECK_PASSWORD || '123456789';
const DEMO = '[UAT DEMO]';
const AS_OF = '2026-07-25';
const PERIOD_START = '2026-01-01';

/** @type {string[]} */
let cookies = [];

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
          ...(cookies.length ? { Cookie: cookies.join('; ') } : {}),
        },
      },
      (res) => {
        const setCookie = res.headers['set-cookie'];
        if (setCookie) {
          // Merge by cookie name — do not drop the session when a later
          // response only refreshes the bundle cookie.
          const jar = new Map(cookies.map((c) => [c.split('=')[0], c]));
          for (const raw of setCookie) {
            const pair = raw.split(';')[0];
            const name = pair.split('=')[0];
            jar.set(name, pair);
          }
          cookies = [...jar.values()];
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(data);
          } catch {
            json = { raw: data };
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function trpcGet(procedure, input = {}) {
  const enc = encodeURIComponent(JSON.stringify(input));
  return request('GET', `/trpc/${procedure}?input=${enc}`);
}

async function trpcPost(procedure, body) {
  return request('POST', `/trpc/${procedure}`, body);
}

function data(res) {
  if (res.json?.error) {
    const msg = res.json.error.message || JSON.stringify(res.json.error);
    throw new Error(msg);
  }
  return res.json?.result?.data;
}

function log(step, detail = '') {
  console.log(`  ✓ ${step}${detail ? ` — ${detail}` : ''}`);
}

function warn(step, detail = '') {
  console.log(`  · ${step}${detail ? ` — ${detail}` : ''}`);
}

async function ensurePostedJe(description, lines, postingDate) {
  const journals = data(await trpcGet('generalLedger.listJournalEntries', { limit: 100, search: DEMO }));
  const existing = journals?.records?.find((j) => String(j.description ?? '').includes(description));
  if (existing) {
    warn(`JE already exists: ${description}`, existing.status);
    return existing;
  }
  const created = data(
    await trpcPost('generalLedger.createJournalEntry', {
      postingDate,
      description: `${DEMO} ${description}`,
      isDraft: false,
      lines,
    }),
  );
  if (created?.status === 'DRAFT' && created?.id) {
    const approved = data(
      await trpcPost('generalLedger.approveJournalEntry', { journalEntryId: created.id }),
    );
    log(`Posted JE: ${description}`, approved?.status ?? created.status);
    return approved ?? created;
  }
  log(`Posted JE: ${description}`, created?.status);
  return created;
}

async function main() {
  console.log(`\nAccounting demo seed → ${API}\n`);

  const login = await request('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (login.status !== 200) {
    throw new Error(`Login failed (${login.status}): ${login.json?.message ?? 'check credentials'}`);
  }
  log('Login', login.json?.user?.role ?? EMAIL);

  // Pin session to an active company so SuperAdmin writes are not groupId=null.
  const groups = data(await trpcGet('branches.listGroups', {})) ?? [];
  const groupList = Array.isArray(groups) ? groups : groups?.groups ?? groups?.records ?? [];
  const company =
    groupList.find((g) => g.status === 'ACTIVE' || !g.status) ?? groupList[0] ?? null;
  if (company?.id) {
    const branchRows = data(await trpcGet('branches.list', {})) ?? [];
    const branches = Array.isArray(branchRows) ? branchRows : branchRows?.branches ?? [];
    const companyBranchIds = branches
      .filter((b) => b.groupId === company.id)
      .map((b) => b.id);
    if (companyBranchIds.length > 0) {
      const switched = await request('POST', '/auth/switch-branch', {
        branchId: null,
        selectedBranchIds: companyBranchIds,
      });
      log(
        'Company scope',
        `${company.name ?? company.id.slice(0, 8)} (${companyBranchIds.length} branches) status=${switched.status}`,
      );
    } else {
      warn('Company scope', `${company.name ?? company.id}: no branches found`);
    }
  } else {
    warn('Company scope', 'no branch groups returned — using login session defaults');
  }

  // CoA
  const seedCoa = data(await trpcPost('generalLedger.seedChartOfAccounts', {}));
  log('Chart of Accounts', `seeded ${seedCoa?.seeded ?? 0}, linked ${seedCoa?.linked ?? 0}`);

  const accounts = data(await trpcGet('generalLedger.listAccounts', {}));
  const byCode = new Map((accounts ?? []).map((a) => [a.code, a]));
  const need = (code) => {
    const a = byCode.get(code);
    if (!a?.id) throw new Error(`Missing account ${code} — CoA seed incomplete for this company`);
    return a;
  };

  const bank = need('1112');
  const ar = need('1121');
  const ap = need('2111');
  const vat = need('2141');
  const equity = need('3900');
  const sales = need('4110');
  const salaries = need('6110');
  const office = byCode.get('6220') ?? byCode.get('6210') ?? salaries;

  // Fiscal year
  let fiscalYears = data(await trpcGet('generalLedger.listFiscalYears', {}));
  let openFy = fiscalYears?.find((fy) => fy.status === 'OPEN');
  if (!openFy) {
    openFy = data(
      await trpcPost('generalLedger.createFiscalYear', {
        name: 'FY 2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      }),
    );
    log('Created fiscal year', openFy?.name);
  } else {
    log('Open fiscal year', openFy.name);
  }

  // Opening balances (one-shot)
  const journalsBefore = data(await trpcGet('generalLedger.listJournalEntries', { limit: 100 }));
  const hasOpening = journalsBefore?.records?.some((j) =>
    String(j.description ?? '')
      .toLowerCase()
      .includes('opening balance'),
  );
  if (!hasOpening) {
    const ob = data(
      await trpcPost('generalLedger.postOpeningBalances', {
        postingDate: PERIOD_START,
        lines: [
          { accountId: bank.id, debit: 5_000_000, credit: 0 },
          { accountId: ar.id, debit: 750_000, credit: 0 },
        ],
      }),
    );
    log('Opening balances', ob?.id?.slice(0, 8) ?? 'posted');
  } else {
    warn('Opening balances', 'already posted');
  }

  // Revenue + VAT (feeds P&L, BS, VAT return, cash flow)
  await ensurePostedJe(
    'Product sale with VAT (inclusive)',
    [
      { accountId: ar.id, debit: 1_075_000, credit: 0, remarks: 'Customer Adaobi Okeke' },
      { accountId: sales.id, debit: 0, credit: 1_000_000, remarks: 'Product sales' },
      { accountId: vat.id, debit: 0, credit: 75_000, remarks: 'Output VAT 7.5%' },
    ],
    '2026-06-15',
  );

  // Remittance / cash collection (clears part of AR, banks cash)
  await ensurePostedJe(
    'Cash collection from customer',
    [
      { accountId: bank.id, debit: 800_000, credit: 0, remarks: 'Banked remittance' },
      { accountId: ar.id, debit: 0, credit: 800_000, remarks: 'Customer Adaobi Okeke' },
    ],
    '2026-06-20',
  );

  // Older AR for aging buckets
  await ensurePostedJe(
    'Aged receivable — customer Chinedu',
    [
      { accountId: ar.id, debit: 220_000, credit: 0, remarks: 'Customer Chinedu Bello' },
      { accountId: sales.id, debit: 0, credit: 204_651, remarks: 'Aged sale' },
      { accountId: vat.id, debit: 0, credit: 15_349, remarks: 'Output VAT' },
    ],
    '2026-03-01',
  );

  // AP payable for aging PAYABLE
  await ensurePostedJe(
    'Supplier invoice on credit',
    [
      { accountId: office.id, debit: 180_000, credit: 0, remarks: 'Office supplies — Vendor Lagos Print' },
      { accountId: ap.id, debit: 0, credit: 180_000, remarks: 'Vendor Lagos Print' },
    ],
    '2026-05-10',
  );

  // Operating expense via bank
  await ensurePostedJe(
    'Staff salaries payment',
    [
      { accountId: salaries.id, debit: 350_000, credit: 0, remarks: 'June salaries' },
      { accountId: bank.id, debit: 0, credit: 350_000, remarks: 'Bank payment' },
    ],
    '2026-06-28',
  );

  // Leave a draft JE visible on Journal Entries
  const draftSearch = data(
    await trpcGet('generalLedger.listJournalEntries', { limit: 50, status: 'DRAFT', search: DEMO }),
  );
  const hasDraft = draftSearch?.records?.some((j) =>
    String(j.description ?? '').includes('Draft rent accrual'),
  );
  if (!hasDraft) {
    const draft = data(
      await trpcPost('generalLedger.createJournalEntry', {
        postingDate: AS_OF,
        description: `${DEMO} Draft rent accrual (leave as DRAFT for UI)`,
        isDraft: true,
        lines: [
          { accountId: office.id, debit: 45_000, credit: 0, remarks: 'Rent accrual' },
          { accountId: ap.id, debit: 0, credit: 45_000, remarks: 'Landlord' },
        ],
      }),
    );
    log('Draft JE (unapproved)', draft?.status);
  } else {
    warn('Draft JE', 'already present');
  }

  // Expenses page
  const expenses = data(await trpcGet('generalLedger.listExpenses', { limit: 50 }));
  const expenseList = Array.isArray(expenses?.expenses)
    ? expenses.expenses
    : Array.isArray(expenses?.records)
      ? expenses.records
      : Array.isArray(expenses)
        ? expenses
        : [];
  let demoExpense = expenseList.find(
    (e) =>
      String(e.description ?? '').includes(DEMO) || String(e.vendorName ?? '').includes('UAT Demo'),
  );
  if (!demoExpense) {
    demoExpense = data(
      await trpcPost('generalLedger.submitExpense', {
        vendorName: 'UAT Demo Logistics Ltd',
        description: `${DEMO} Courier fuel reimbursement`,
        amount: 32_500,
      }),
    );
    log('Expense submitted', demoExpense?.status);
  } else {
    warn('Expense', `${demoExpense.status} already present`);
  }
  if (demoExpense?.id && demoExpense.status === 'PENDING') {
    try {
      const approved = data(
        await trpcPost('generalLedger.approveExpense', {
          expenseId: demoExpense.id,
          glAccountId: office.id,
        }),
      );
      log('Expense approved', approved?.status ?? approved?.id?.slice(0, 8));
    } catch (e) {
      warn('Expense approve skipped', e.message);
    }
  }

  // Asset register
  const assets = data(await trpcGet('generalLedger.listAssets', { limit: 20 }));
  const assetRows = assets?.records ?? assets?.items ?? (Array.isArray(assets) ? assets : []);
  const hasAsset = assetRows.some((a) => String(a.assetName ?? '').includes('UAT Demo'));
  if (!hasAsset) {
    const asset = data(
      await trpcPost('generalLedger.createAsset', {
        assetName: 'UAT Demo Office Laptop',
        assetCategory: 'IT Equipment',
        acquisitionDate: '2026-02-01',
        cost: 850_000,
        residualValue: 50_000,
        usefulLifeMonths: 36,
        depreciationMethod: 'STRAIGHT_LINE',
        location: 'HQ',
        notes: `${DEMO} asset for Asset Register page`,
      }),
    );
    log('Fixed asset', asset?.assetName ?? asset?.id?.slice(0, 8));
    try {
      const dep = data(
        await trpcPost('generalLedger.runDepreciation', { periodDate: '2026-06-30' }),
      );
      log('Depreciation run', JSON.stringify(dep ?? {}).slice(0, 80));
    } catch (e) {
      warn('Depreciation', e.message);
    }
  } else {
    warn('Fixed asset', 'already present');
  }

  // WHT + certificate
  const whtList = data(await trpcGet('generalLedger.listWht', { limit: 50 }));
  const whtRows = whtList?.records ?? (Array.isArray(whtList) ? whtList : []);
  const hasWht = whtRows.some((w) => String(w.vendorName ?? '').includes('UAT Demo'));
  if (!hasWht) {
    const wht = data(
      await trpcPost('generalLedger.recordWht', {
        vendorName: 'UAT Demo Consulting NG',
        paymentDate: '2026-07-10',
        grossAmount: 200_000,
        whtRate: 5,
        description: `${DEMO} professional fees WHT`,
      }),
    );
    log('WHT deduction', wht?.id?.slice(0, 8));
    if (wht?.id) {
      try {
        const cert = data(
          await trpcPost('generalLedger.generateWhtCertificate', { deductionId: wht.id }),
        );
        log('WHT certificate', cert?.id?.slice(0, 8) ?? 'generated');
      } catch (e) {
        warn('WHT certificate', e.message);
      }
    }
  } else {
    warn('WHT', 'already present');
  }

  // Budget report
  const budgets = data(await trpcGet('finance.listBudgets', {}));
  const budgetRows = Array.isArray(budgets) ? budgets : budgets?.records ?? [];
  const hasBudget = budgetRows.some((b) => String(b.name ?? '').includes('UAT Demo'));
  if (!hasBudget) {
    const budget = data(
      await trpcPost('finance.setBudget', {
        name: 'UAT Demo Ops Budget',
        departmentOrCampaign: 'Operations',
        totalBudget: 2_500_000,
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2026-12-31T23:59:59.000Z',
      }),
    );
    log('Budget', budget?.name);
  } else {
    warn('Budget', 'already present');
  }

  // Bank reconciliation
  const recons = data(await trpcGet('generalLedger.listBankReconciliations', { limit: 20 }));
  const reconRows = recons?.records ?? (Array.isArray(recons) ? recons : []);
  if (reconRows.length === 0) {
    try {
      const recon = data(
        await trpcPost('generalLedger.createBankReconciliation', {
          bankAccountId: bank.id,
          statementDate: AS_OF,
          statementBalance: 5_450_000,
          statementLines: [
            { date: '2026-06-20', description: `${DEMO} Remittance deposit`, amount: 800_000 },
            { date: '2026-06-28', description: `${DEMO} Salaries outflow`, amount: -350_000 },
            { date: '2026-07-10', description: `${DEMO} Consulting net pay`, amount: -190_000 },
          ],
        }),
      );
      log('Bank reconciliation', recon?.id?.slice(0, 8) ?? 'created');
    } catch (e) {
      warn('Bank reconciliation', e.message);
    }
  } else {
    warn('Bank reconciliation', `${reconRows.length} already exist`);
  }

  // Payroll GL backfill (if any paid batches)
  try {
    const backfill = data(await trpcPost('generalLedger.backfillPaidPayrollGl', {}));
    log(
      'Payroll GL backfill',
      `posted ${backfill?.posted ?? 0}, skipped ${backfill?.skipped ?? 0}`,
    );
  } catch (e) {
    warn('Payroll GL backfill', e.message);
  }

  // Verify report endpoints respond with data
  const tb = data(await trpcGet('generalLedger.trialBalance', { asOfDate: AS_OF }));
  log(
    'Trial Balance',
    `Dr ${tb?.totals?.totalDebit ?? '?'} Cr ${tb?.totals?.totalCredit ?? '?'} balanced=${tb?.totals?.balanced}`,
  );

  const pl = data(
    await trpcGet('generalLedger.profitAndLoss', { startDate: PERIOD_START, endDate: AS_OF }),
  );
  log('P&L', `net ${pl?.netProfit ?? pl?.totals?.netProfit ?? 'ok'}`);

  const bs = data(await trpcGet('generalLedger.balanceSheet', { asOfDate: AS_OF }));
  log('Balance Sheet', `assets ${bs?.totals?.assets ?? bs?.totalAssets ?? 'ok'}`);

  const cf = data(
    await trpcGet('generalLedger.cashFlow', { startDate: PERIOD_START, endDate: AS_OF }),
  );
  log('Cash Flow', cf ? 'ok' : 'empty');

  const agingAr = data(
    await trpcGet('generalLedger.aging', { kind: 'RECEIVABLE', asOfDate: AS_OF }),
  );
  log('Aging AR', `${agingAr?.parties?.length ?? agingAr?.length ?? 0} parties`);

  const vatSummary = data(
    await trpcGet('generalLedger.vatReturnSummary', {
      startDate: PERIOD_START,
      endDate: AS_OF,
    }),
  );
  log(
    'VAT return',
    `output ${vatSummary?.outputVat ?? 0}, net ${vatSummary?.netVatPayable ?? 0}`,
  );

  const budgetReport = data(
    await trpcGet('generalLedger.budgetVsActual', {
      startDate: PERIOD_START,
      endDate: AS_OF,
    }),
  );
  log('Budget vs Actual', `${Array.isArray(budgetReport) ? budgetReport.length : 0} rows`);

  console.log(`
Done. Refresh Accounting pages (select the company in the header):

  CoA                 /admin/finance/accounts
  Opening Balances    /admin/finance/opening-balances
  Journal Entries     /admin/finance/journal-entries
  Expenses            /admin/finance/expenses
  Bank Reconciliation /admin/finance/bank-reconciliation
  General Ledger      /admin/finance/general-ledger
  Trial Balance       /admin/finance/trial-balance
  P&L                 /admin/finance/profit-loss
  Balance Sheet       /admin/finance/balance-sheet
  Cash Flow           /admin/finance/cash-flow
  Assets (dev)        /admin/finance/assets
  Aging (dev)         /admin/finance/aging
  Tax Returns (dev)   /admin/finance/tax-returns
  WHT (dev)           /admin/finance/wht-certificates
  Budget (dev)        /admin/finance/budget-report
`);
}

main().catch((e) => {
  console.error('\nSeed failed:', e.message);
  process.exit(1);
});
