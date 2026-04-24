-- Track whether each push subscription is installed as a PWA (home-screen icon) or running
-- in a normal browser tab. Refreshed on every app mount via the `updateInstallMode` heartbeat.
-- See enums.ts :: pushInstallModeEnum for semantics.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'push_install_mode') THEN
    CREATE TYPE "push_install_mode" AS ENUM ('STANDALONE', 'BROWSER', 'UNKNOWN');
  END IF;
END
$$;

ALTER TABLE "push_subscriptions"
  ADD COLUMN IF NOT EXISTS "install_mode" "push_install_mode" NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE "push_subscriptions"
  ADD COLUMN IF NOT EXISTS "install_mode_updated_at" timestamptz;
