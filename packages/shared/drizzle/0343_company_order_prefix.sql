-- Company order prefix.
--
-- Order labels shared a single hardcoded "YNS-" prefix, so nothing on the face
-- of an order number said which company it belonged to: a Zarvon order read
-- YNS-113037, identical to a Yannis one, and you had to read the campaign name
-- to tell them apart.
--
-- Stored on branch_groups rather than stamped onto orders: an order's company
-- is always derivable through its branch, so a per-company row keeps the value
-- queryable and exportable without denormalising ~113k order rows (and their
-- history table) or going stale if an order ever changes branch.

ALTER TABLE branch_groups
  ADD COLUMN IF NOT EXISTS order_prefix varchar(5);

-- Seed: the original company keeps YNS — months of screenshots, exports and
-- WhatsApp threads carry that prefix. Newer companies take the first three
-- letters of their name, which is what distinguishes them.
UPDATE branch_groups
SET order_prefix = CASE
  WHEN name ILIKE 'yannis%' THEN 'YNS'
  WHEN length(regexp_replace(name, '[^A-Za-z]', '', 'g')) >= 2
    THEN upper(left(regexp_replace(name, '[^A-Za-z]', '', 'g'), 3))
  ELSE 'YNS'
END
WHERE order_prefix IS NULL;

-- Every company must resolve to a prefix; a NULL would silently fall back to
-- YNS at render time and reintroduce the ambiguity this column exists to fix.
ALTER TABLE branch_groups
  ALTER COLUMN order_prefix SET DEFAULT 'YNS';

ALTER TABLE branch_groups
  ALTER COLUMN order_prefix SET NOT NULL;
