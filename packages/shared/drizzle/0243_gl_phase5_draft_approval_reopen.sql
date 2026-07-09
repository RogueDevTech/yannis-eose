-- Phase 5 remaining features:
-- 1. Add DRAFT status to journal_entry_status for approval workflow
-- 2. Add approved_by / approved_at columns to journal_entries

-- Feature 3: Journal DRAFT status + approval columns
ALTER TYPE journal_entry_status ADD VALUE IF NOT EXISTS 'DRAFT';

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
