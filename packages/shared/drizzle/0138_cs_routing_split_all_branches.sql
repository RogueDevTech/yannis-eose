-- Adds the SPLIT_ALL_BRANCHES routing mode: every order, regardless of which
-- marketing branch generated it, is dispatched to whichever CS closer (across
-- ALL branches) has the lowest pending workload. New default for fresh
-- branches; existing branches keep whichever value they already saved.
--
-- ALTER TYPE ... ADD VALUE works inside a transaction on Postgres 12+ (we run
-- 18). The new value cannot be referenced inside the SAME transaction it was
-- created in, so we keep this migration to a single statement and let any
-- follow-up code/migrations use the value normally.

ALTER TYPE cs_routing_relationship_mode ADD VALUE IF NOT EXISTS 'SPLIT_ALL_BRANCHES';
