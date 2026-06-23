-- Migration 0222: Add ORDER_FROZEN timeline event type
-- CEO directive 2026-06-23: permission-based freeze/unfreeze of orders

ALTER TYPE "public"."timeline_event_type" ADD VALUE IF NOT EXISTS 'ORDER_FROZEN';
