-- Contractor payout lines have contractor_id set and staff_id NULL.
-- Live payout_records already allows that; history lagged with NOT NULL staff_id,
-- so history triggers failed on contractor inserts.
ALTER TABLE payout_records_history
  ALTER COLUMN staff_id DROP NOT NULL;
