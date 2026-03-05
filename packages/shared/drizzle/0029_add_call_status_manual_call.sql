-- Add MANUAL_CALL to call_status enum for manual-call flow when VOIP is disabled
ALTER TYPE "public"."call_status" ADD VALUE 'MANUAL_CALL';
