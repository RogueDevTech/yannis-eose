-- Add PENDING and DEACTIVATED to record_status (Option B: PENDING = invited never logged in; DEACTIVATED = permanent, view-only)
ALTER TYPE record_status ADD VALUE 'PENDING';
ALTER TYPE record_status ADD VALUE 'DEACTIVATED';
