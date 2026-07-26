-- Add job_title column to payroll_contractors + its history table.
ALTER TABLE payroll_contractors ADD COLUMN IF NOT EXISTS job_title text;
ALTER TABLE payroll_contractors_history ADD COLUMN IF NOT EXISTS job_title text;
