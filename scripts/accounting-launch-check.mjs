#!/usr/bin/env node
/**
 * Accounting launch checklist — run against local API.
 * Usage: node scripts/accounting-launch-check.mjs
 */
import http from 'node:http';

const API = process.env.API_URL?.replace(/\/$/, '') || 'http://localhost:4444';
const EMAIL = process.env.ACCOUNTING_CHECK_EMAIL || 'kbshowkb@gmail.com';
const PASSWORD = process.env.ACCOUNTING_CHECK_PASSWORD || '123456789';

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
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(cookies.length ? { Cookie: cookies.join('; ') } : {}),
        },
      },
      (res) => {
        const setCookie = res.headers['set-cookie'];
        if (setCookie) cookies = setCookie.map((c) => c.split(';')[0]);
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
  if (res.json?.error) throw new Error(res.json.error.message || JSON.stringify(res.json.error));
  return res.json?.result?.data;
}

function ok(label, pass, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${label}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

async function main() {
  console.log(`\nAccounting launch checklist → ${API}\n`);

  // 1. Login
  const login = await request('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  ok('Login', login.status === 200, login.json?.user?.role ?? login.json?.message);

  // 2. List accounts (COA seeded?)
  const accounts = data(await trpcGet('generalLedger.listAccounts', {}));
  ok('Chart of accounts', Array.isArray(accounts) && accounts.length > 20, `${accounts?.length ?? 0} accounts`);

  const byCode = new Map((accounts ?? []).map((a) => [a.code, a]));
  const bank = byCode.get('1112');
  const equity = byCode.get('3900');
  const salaries = byCode.get('6110');
  const payrollPayable = byCode.get('2205') ?? byCode.get('2105');
  ok('Bank account 1112', !!bank?.id);
  ok('Opening equity 3900', !!equity?.id);
  ok('Salary expense 6110', !!salaries?.id);

  // 3. Fiscal years
  let fiscalYears = data(await trpcGet('generalLedger.listFiscalYears', {}));
  let openFy = fiscalYears?.find((fy) => fy.status === 'OPEN');
  if (!openFy) {
    const created = data(
      await trpcPost('generalLedger.createFiscalYear', {
        name: 'FY 2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      }),
    );
    openFy = created;
    ok('Create fiscal year FY 2026', !!created?.id);
  } else {
    ok('Open fiscal year exists', true, openFy.name);
  }

  // 4. Trial balance (before)
  const tbBefore = data(await trpcGet('generalLedger.trialBalance', { asOfDate: '2026-07-24' }));
  const tbBalanced =
    Math.abs(Number(tbBefore?.totalDebit ?? 0) - Number(tbBefore?.totalCredit ?? 0)) < 0.01;
  ok(
    'Trial balance API (before)',
    !!tbBefore,
    `Dr ${tbBefore?.totals?.totalDebit ?? tbBefore?.rawTotals?.debit} Cr ${tbBefore?.totals?.totalCredit ?? tbBefore?.rawTotals?.credit}`,
  );

  // 5. Opening balances (skip if already posted)
  const journalsBefore = data(await trpcGet('generalLedger.listJournalEntries', { limit: 100 }));
  const hasOpening = journalsBefore?.records?.some((j) =>
    String(j.description ?? '').includes('Opening balances'),
  );
  if (!hasOpening && bank?.id) {
    const ob = data(
      await trpcPost('generalLedger.postOpeningBalances', {
        postingDate: '2026-01-01',
        lines: [{ accountId: bank.id, debit: 5000000, credit: 0 }],
      }),
    );
    ok('Post opening balances (₦5M bank)', !!ob?.id, ob?.id?.slice(0, 8));
  } else {
    ok('Opening balances', true, hasOpening ? 'already posted' : 'skipped (no bank account)');
  }

  // 6. Manual journal: draft → approve
  const expenseAcct = byCode.get('6110') ?? salaries;
  let draftJe = null;
  if (bank?.id && expenseAcct?.id) {
    draftJe = data(
      await trpcPost('generalLedger.createJournalEntry', {
        postingDate: '2026-07-24',
        description: 'UAT smoke test journal — office supplies',
        isDraft: true,
        lines: [
          { accountId: expenseAcct.id, debit: 25000, credit: 0, remarks: 'Supplies' },
          { accountId: bank.id, debit: 0, credit: 25000, remarks: 'Bank payment' },
        ],
      }),
    );
    ok('Create draft journal', draftJe?.status === 'DRAFT', `id ${draftJe?.id?.slice(0, 8)}`);

    if (draftJe?.id) {
      const approved = data(
        await trpcPost('generalLedger.approveJournalEntry', { journalEntryId: draftJe.id }),
      );
      ok('Approve journal → POSTED', approved?.status === 'POSTED', approved?.status);
    }
  } else {
    ok('Manual journal', false, 'missing accounts');
  }

  // 7. Trial balance (after)
  const tbAfter = data(await trpcGet('generalLedger.trialBalance', { asOfDate: '2026-07-24' }));
  const tbAfterBalanced = tbAfter?.totals?.balanced === true;
  ok(
    'Trial balance balanced (after)',
    tbAfterBalanced,
    `Dr ${tbAfter?.totals?.totalDebit} Cr ${tbAfter?.totals?.totalCredit}`,
  );

  // 8. Payroll GL backfill + verify idempotent repost for Marketing May batch
  const mktBatchId = '019e3001-0004-7000-a000-000000000004';
  const backfill = data(await trpcPost('generalLedger.backfillPaidPayrollGl', {}));
  ok(
    'Payroll GL backfill',
    (backfill?.posted ?? 0) > 0 || (backfill?.skipped ?? 0) > 0,
    `posted ${backfill?.posted ?? 0}, skipped ${backfill?.skipped ?? 0}`,
  );

  const mktRepost = data(
    await trpcPost('generalLedger.repostPayrollBatch', { batchId: mktBatchId }),
  );
  ok(
    'Marketing May batch GL posted',
    mktRepost?.posted === true || mktRepost?.reason === 'already-posted',
    mktRepost?.posted ? 'posted now' : mktRepost?.reason ?? 'unknown',
  );

  const plPayroll = data(
    await trpcGet('generalLedger.profitAndLoss', { startDate: '2026-01-01', endDate: '2026-07-24' }),
  );
  const salaryExpense = Number(
    plPayroll?.expense?.find?.((e) => e.code === '6110')?.amount ?? 0,
  );
  ok(
    'Payroll expense in P&L (6110)',
    salaryExpense > 100000,
    `₦${salaryExpense.toLocaleString()} salary expense`,
  );

  // 9. P&L + Balance sheet
  const pl = data(
    await trpcGet('generalLedger.profitAndLoss', { startDate: '2026-01-01', endDate: '2026-07-24' }),
  );
  ok('Profit & Loss report', !!pl, `net ${pl?.netProfit ?? pl?.totals?.netProfit ?? 'n/a'}`);

  const bs = data(await trpcGet('generalLedger.balanceSheet', { asOfDate: '2026-07-24' }));
  ok('Balance sheet report', !!bs, `assets ${bs?.totals?.assets ?? bs?.totalAssets ?? 'n/a'}`);

  const cf = data(
    await trpcGet('generalLedger.cashFlow', { startDate: '2026-01-01', endDate: '2026-07-24' }),
  );
  ok('Cash flow report', !!cf);

  // 10. Journal list includes payroll + opening
  const journalsAfter = data(await trpcGet('generalLedger.listJournalEntries', { limit: 50 }));
  const payrollJeCount = journalsAfter?.records?.filter((j) =>
    String(j.description ?? '').toLowerCase().includes('payroll'),
  ).length;
  ok('Journal entries list', (journalsAfter?.records?.length ?? 0) > 0, `${journalsAfter?.records?.length} entries, ${payrollJeCount} payroll-related`);

  console.log('\nDone.\n');
}

main().catch((e) => {
  console.error('Checklist failed:', e.message);
  process.exit(1);
});
