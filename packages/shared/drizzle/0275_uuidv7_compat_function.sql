-- Compat: cart-order pull/backfill raw SQL calls uuidv7().
-- Native on PostgreSQL 18+; AWS/dev may still be PG 15 without it.
-- Without this, Step A/B of pullFromAbandonedCarts fails and Cart Orders
-- show blank Product/Amount until a later boot backfill (often ~24h).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'uuidv7'
      AND n.nspname = 'public'
      AND pg_get_function_identity_arguments(p.oid) = ''
  ) THEN
    CREATE FUNCTION public.uuidv7() RETURNS uuid
    LANGUAGE plpgsql
    VOLATILE
    AS $fn$
    DECLARE
      unix_ts_ms bytea;
      uuid_bytes bytea;
    BEGIN
      unix_ts_ms := substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3);
      uuid_bytes := unix_ts_ms || gen_random_bytes(10);
      -- version 7
      uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
      -- RFC 4122 variant
      uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);
      RETURN encode(uuid_bytes, 'hex')::uuid;
    END
    $fn$;
  END IF;
END $$;
