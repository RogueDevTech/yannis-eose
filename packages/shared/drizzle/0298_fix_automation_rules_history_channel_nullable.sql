-- 0298: Fix history-trigger drift on automation_rules.channel
--
-- Migration 0291 relaxed the legacy `channel` column to NULLABLE on the LIVE
-- automation_rules table (new multi-channel rules write `channels` and leave
-- `channel` NULL), but it never mirrored that change onto the history twin
-- automation_rules_history. That table's `channel` stayed NOT NULL.
--
-- Result: creating any rule with channel = NULL triggers yannis_capture_history()
-- to INSERT the row into automation_rules_history, where the NULL channel violates
-- the stale NOT NULL constraint — failing the whole write with
-- "null value in column \"channel\" of relation \"automation_rules_history\"
-- violates not-null constraint".
--
-- Fix: relax the history column to match the live table. History tables never
-- enforce business constraints anyway (they store whatever the live row held).

ALTER TABLE automation_rules_history ALTER COLUMN channel DROP NOT NULL;
