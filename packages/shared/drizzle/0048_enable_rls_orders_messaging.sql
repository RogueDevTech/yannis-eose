-- Fix: orders table had a branch_scope policy defined in 0042 but RLS was never enabled,
-- making the policy completely inert. Enable it now.
-- Also enable RLS on message_templates and outbound_messages which carry branch_id
-- but were missing from the original 0042 migration.

-- ── ORDERS ────────────────────────────────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Policy already created in 0042 — no need to recreate, enabling RLS activates it.

-- ── MESSAGE_TEMPLATES ─────────────────────────────────────────────────────────
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_templates_branch_scope ON message_templates;

CREATE POLICY message_templates_branch_scope ON message_templates
  AS RESTRICTIVE
  FOR ALL
  USING (yannis_branch_matches(branch_id));

-- ── OUTBOUND_MESSAGES ─────────────────────────────────────────────────────────
ALTER TABLE outbound_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outbound_messages_branch_scope ON outbound_messages;

CREATE POLICY outbound_messages_branch_scope ON outbound_messages
  AS RESTRICTIVE
  FOR ALL
  USING (yannis_branch_matches(branch_id));
