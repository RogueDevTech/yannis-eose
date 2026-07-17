-- Add AUDITOR role — read-only finance-scoped role for external/internal auditors.
-- Sees GL, journal entries, trial balance, financial reports, and audit trail.
-- Cannot mutate any data (no write permissions granted). Unlike SUPPORT, the
-- AUDITOR role does NOT bypass permissionProcedure — it relies entirely on
-- its permission snapshot (finance.read, finance.ledger.read, etc.).

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'AUDITOR';
