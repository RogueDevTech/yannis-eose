-- ============================================
-- Multi-currency — Phase 0: Foundation (dormant)
-- ============================================
-- currencies — per-group (per-"company") currency + country config. The whole
--   multi-currency feature stays DORMANT until a group has a 2nd ACTIVE currency:
--   with only the seeded NGN default, hasMultipleCurrencies() is false and no UI
--   surfaces change anywhere.
--
--   FX (fx_rate_to_base) is a REPORTING LENS ONLY (ROAS / future consolidation).
--   It NEVER converts stored operational money. Direction: 1 unit of THIS currency
--   = fx_rate_to_base units of the group's DEFAULT (base) currency. Base row = 1.
--   NULL until an admin sets it → ratio metrics show "Set FX rate" instead of a
--   wrong number.
--
-- History twin: generic positional trigger yannis_capture_history() (new-table
--   pattern, mirrors attendance_records mig 0309). CRITICAL: unlike 0309, we DROP
--   the PK + UNIQUE constraints/indexes the `LIKE ... INCLUDING ALL` copies to the
--   history twin — those reject the 2nd captured version of the same row and were
--   the exact bug fixed in 0310. We bake that fix in here from the start.

-- ── currencies ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS currencies (
  id uuid PRIMARY KEY,
  group_id uuid REFERENCES branch_groups(id),
  code text NOT NULL,              -- ISO 4217, e.g. 'NGN', 'GHS'
  symbol text NOT NULL,            -- '₦', 'GH₵'
  country_name text NOT NULL,      -- 'Nigeria', 'Ghana' (label only)
  precision integer NOT NULL DEFAULT 2,
  is_default boolean NOT NULL DEFAULT false,  -- the group's base currency
  active boolean NOT NULL DEFAULT true,
  fx_rate_to_base numeric(18,6),   -- NULL until set. 1 THIS = N base units.
  fx_rate_updated_at timestamptz,
  fx_rate_updated_by uuid REFERENCES users(id),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per (group, code). NULL group_id = legacy/global (mirrors system_settings).
-- COALESCE to a sentinel because SQL treats NULL as DISTINCT in unique indexes —
-- without it, two NULL-group rows with the same code would BOTH be allowed.
CREATE UNIQUE INDEX IF NOT EXISTS currencies_group_code_uniq
  ON currencies (COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid), code);
-- Exactly one default currency per group (same NULL-sentinel reasoning — the
-- legacy/global null-group must not be allowed two defaults either).
CREATE UNIQUE INDEX IF NOT EXISTS currencies_group_default_uniq
  ON currencies (COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE is_default;
-- "active currencies for this group" scan (the dormancy check + dropdown source).
CREATE INDEX IF NOT EXISTS currencies_group_active_idx
  ON currencies (group_id, active);

-- Durable + audited → full temporal history table.
CREATE TABLE IF NOT EXISTS currencies_history (
  LIKE currencies INCLUDING ALL
);

-- Drop PK + UNIQUE constraints AND unique indexes copied to the history twin by
-- LIKE INCLUDING ALL — a history table stores MANY versions of the same row, so
-- those constraints reject the 2nd capture. (This is the 0310 fix, applied at
-- birth so currencies never hits the bulk-capture crash attendance did.)
DO $$
DECLARE _c text; _i text;
BEGIN
  FOR _c IN
    SELECT tc.constraint_name FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public' AND tc.table_name = 'currencies_history'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  LOOP
    EXECUTE format('ALTER TABLE currencies_history DROP CONSTRAINT IF EXISTS %I', _c);
  END LOOP;
  FOR _i IN
    SELECT indexrelid::regclass::text FROM pg_index i
    WHERE i.indisunique AND i.indrelid = 'public.currencies_history'::regclass
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %s', _i);
  END LOOP;
END $$;

-- Temporal triggers (generic positional, new-table pattern — mirrors 0309).
DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_currencies_stamp_actor ON currencies;
  CREATE TRIGGER trg_currencies_stamp_actor
    BEFORE INSERT OR UPDATE ON currencies
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_currencies_capture_history ON currencies;
  CREATE TRIGGER trg_currencies_capture_history
    BEFORE UPDATE OR DELETE ON currencies
    FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

  DROP TRIGGER IF EXISTS trg_currencies_history_immutable ON currencies_history;
  CREATE TRIGGER trg_currencies_history_immutable
    BEFORE UPDATE OR DELETE ON currencies_history
    FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
END $$;

-- Register for audit tooling.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_table_registry') THEN
    INSERT INTO audit_table_registry (table_name) VALUES ('currencies') ON CONFLICT DO NOTHING;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── Seed NGN as the default currency for every existing branch group ─────────
-- Idempotent: skips any group that already has an NGN row. Uses uuidv7-ish
-- gen_random_uuid() (id is a plain uuid PK; app-side inserts use uuidv7, but a
-- seed row's ordering doesn't matter). fx_rate_to_base = 1 (base currency).
INSERT INTO currencies (id, group_id, code, symbol, country_name, precision, is_default, active, fx_rate_to_base)
SELECT gen_random_uuid(), bg.id, 'NGN', '₦', 'Nigeria', 2, true, true, 1
FROM branch_groups bg
WHERE NOT EXISTS (
  SELECT 1 FROM currencies c WHERE c.group_id = bg.id AND c.code = 'NGN'
);

-- Also seed a NULL-group NGN row (legacy/global fallback, mirrors how
-- system_settings tolerates NULL group_id) so a group-less lookup still resolves.
INSERT INTO currencies (id, group_id, code, symbol, country_name, precision, is_default, active, fx_rate_to_base)
SELECT gen_random_uuid(), NULL, 'NGN', '₦', 'Nigeria', 2, true, true, 1
WHERE NOT EXISTS (
  SELECT 1 FROM currencies c WHERE c.group_id IS NULL AND c.code = 'NGN'
);
