-- Slim Chart of Accounts: deactivate unused accounts, flatten hierarchy.
-- Accounts with GL entries are preserved regardless.

-- Step 1: Deactivate all accounts NOT in the slim chart and without GL entries.
UPDATE accounts
SET is_active = false, updated_at = now()
WHERE is_active = true
  AND code NOT IN (
    '1000', '1111', '1112', '1121', '1131', '1132', '1133', '1151', '1221',
    '2000', '2111', '2112', '2121', '2122', '2141', '2142', '2143', '2144', '2150',
    '3000', '3110', '3210', '3220', '3900',
    '4000', '4110', '4120', '4210',
    '5000', '5110', '5120', '5130', '5140', '5210', '5220',
    '6000', '6110', '6210', '6310', '6510', '6630', '6900', '6910', '6930',
    '7000', '7110', '7210', '7230',
    '8000', '8110', '8120'
  )
  AND id NOT IN (SELECT DISTINCT account_id FROM gl_entries);

-- Step 2: Re-parent leaf accounts directly under their code-range root.
-- 1xxx → 1000, 2xxx → 2000, 3xxx → 3000, 4xxx → 4000,
-- 5xxx → 5000, 6xxx → 6000, 7xxx → 7000, 8xxx → 8000.
DO $$
DECLARE
  _root_code text;
  _root_prefix text;
BEGIN
  FOR _root_code IN SELECT unnest(ARRAY['1000','2000','3000','4000','5000','6000','7000','8000'])
  LOOP
    _root_prefix := LEFT(_root_code, 1);
    UPDATE accounts a
    SET parent_account_id = r.id
    FROM accounts r
    WHERE r.code = _root_code
      AND r.group_id = a.group_id
      AND r.is_active = true
      AND a.is_active = true
      AND a.is_group = false
      AND a.code LIKE _root_prefix || '%'
      AND a.code != _root_code;
  END LOOP;
END $$;
