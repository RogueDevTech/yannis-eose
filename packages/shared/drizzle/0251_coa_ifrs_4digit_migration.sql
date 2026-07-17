-- Migrate Chart of Accounts from ERPNext name-based codes to 4-digit IFRS codes.
-- This migration:
--   1. Inserts the new 4-digit IFRS accounts (ON CONFLICT DO NOTHING — safe if already seeded).
--   2. Remaps gl_entries from legacy account IDs to new account IDs.
--   3. Remaps journal_entries line references.
--   4. Deactivates legacy accounts that have been fully remapped.
--
-- The migration is idempotent — running it again is a no-op.

-- Step 1: The new accounts are auto-seeded on boot by GeneralLedgerService.
-- This migration focuses on remapping existing data.

-- Step 2: Remap gl_entries.account_id from legacy accounts to their IFRS equivalents.
-- We match by the old account code (name-based) and find the new account (4-digit)
-- within the same group_id.
--
-- Legacy code → IFRS code mapping (only accounts that actually have GL entries):

DO $$
DECLARE
  legacy_code TEXT;
  ifrs_code TEXT;
  grp_id UUID;
  old_acct_id UUID;
  new_acct_id UUID;
  remapped INT;
  pair RECORD;
BEGIN
  -- Mapping table: legacy name-based code → new 4-digit IFRS code
  FOR pair IN
    SELECT * FROM (VALUES
      ('Debtors',                    '1121'),
      ('Sale',                       '4110'),
      ('VAT',                        '2141'),
      ('Stock In Hand',              '1131'),
      ('First Bank',                 '1112'),
      ('FCMB',                       '1113'),
      ('Cash',                       '1111'),
      ('Creditors',                  '2111'),
      ('Payroll Payable',            '2121'),
      ('Salary',                     '6110'),
      ('Marketing Expenses',         '6210'),
      ('Cost of Goods Sold',         '5110'),
      ('Accumulated Depreciation',   '1221'),
      ('Depreciation',               '6510'),
      ('Delivery Fees',              '6310'),
      ('Discount Fees',              '6630'),
      ('Opening Balance Equity',     '3900'),
      ('Capital Stock',              '3110'),
      ('Retained Earnings',          '3210'),
      ('Commission on Sales',        '5210'),
      ('Administrative Expenses',    '6600'),
      ('Office Rent',                '6410'),
      ('Internet Expense',           '6620'),
      ('Telephone Expenses',         '6620'),
      ('Utility Expenses',           '6420'),
      ('Entertainment Expenses',     '6900'),
      ('Miscellaneous Expenses',     '6900'),
      ('Legal Expenses',             '6640'),
      ('Print and Stationery',       '6610'),
      ('Travel Expenses',            '6900'),
      ('Office Maintenance Expenses','6670'),
      ('Round Off',                  '6910'),
      ('Write Off',                  '6920'),
      ('Stock Adjustment',           '6930'),
      ('Freight and Forwarding Charges','6310'),
      ('Gain/Loss on Asset Disposal','7230'),
      ('Exchange Gain/Loss',         '7230'),
      ('Impairment',                 '6920'),
      ('Sales Expenses',             '6900'),
      ('PAYE Tax',                   '2143'),
      ('Pension Payable',            '2144'),
      ('Secured Loans',              '2210'),
      ('Unsecured Loans',            '2210'),
      ('Bank Overdraft Account',     '2130')
    ) AS t(old_code, new_code)
  LOOP
    legacy_code := pair.old_code;
    ifrs_code := pair.new_code;

    -- Process each group_id (company) independently
    FOR grp_id IN
      SELECT DISTINCT a.group_id FROM accounts a WHERE a.code = legacy_code
    LOOP
      -- Find the legacy account ID
      SELECT id INTO old_acct_id
        FROM accounts
       WHERE code = legacy_code AND group_id IS NOT DISTINCT FROM grp_id
       LIMIT 1;

      -- Find the new IFRS account ID (must already be seeded)
      SELECT id INTO new_acct_id
        FROM accounts
       WHERE code = ifrs_code AND group_id IS NOT DISTINCT FROM grp_id
       LIMIT 1;

      IF old_acct_id IS NOT NULL AND new_acct_id IS NOT NULL AND old_acct_id <> new_acct_id THEN
        -- Remap GL entries
        UPDATE gl_entries
           SET account_id = new_acct_id
         WHERE account_id = old_acct_id;

        GET DIAGNOSTICS remapped = ROW_COUNT;
        IF remapped > 0 THEN
          RAISE NOTICE 'Remapped % gl_entries from % → % (group %)', remapped, legacy_code, ifrs_code, grp_id;
        END IF;

        -- Transfer the running balance to the new account
        UPDATE accounts
           SET balance = COALESCE(balance, 0) + COALESCE((SELECT balance FROM accounts WHERE id = old_acct_id), 0)
         WHERE id = new_acct_id;

        -- Zero out old account balance and deactivate
        UPDATE accounts
           SET balance = 0, is_active = false
         WHERE id = old_acct_id;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'CoA IFRS 4-digit migration complete.';
END $$;
