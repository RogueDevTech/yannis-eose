-- 0301: automation_jobs can carry a direct recipient email (for group members).
--
-- Segment broadcasts driven by a Target Group send to members who may have NO
-- order (e.g. CSV-imported, or a group whose match is by phone hash only). Such a
-- job has orderId = NULL, so resolveContext() can't find a recipient. This column
-- lets enqueueSegment stash the member's email on the job so processJob can send
-- to it directly. Raw phone is intentionally NOT stored here (Lead Fortress) —
-- SMS/WhatsApp to order-less members isn't supported; those members are email-only.
--
-- automation_jobs is actor-stamp only (no history table), so this is a plain
-- additive nullable column — no history mirror needed.

ALTER TABLE automation_jobs ADD COLUMN IF NOT EXISTS recipient_email text;
