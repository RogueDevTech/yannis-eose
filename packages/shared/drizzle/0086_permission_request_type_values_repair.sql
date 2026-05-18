-- Idempotent repair for DBs where extended labels were never added (e.g. partial migrate / wrong DB).
ALTER TYPE "permission_request_type" ADD VALUE IF NOT EXISTS 'PRODUCT_ARCHIVE';
ALTER TYPE "permission_request_type" ADD VALUE IF NOT EXISTS 'ORDER_LINE_PRICE_CHANGE';
ALTER TYPE "permission_request_type" ADD VALUE IF NOT EXISTS 'ORDER_DELETION';
