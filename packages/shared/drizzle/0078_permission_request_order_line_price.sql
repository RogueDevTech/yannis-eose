-- CS (and others without direct pricing power) may submit line-item price changes for approval.
ALTER TYPE "permission_request_type" ADD VALUE IF NOT EXISTS 'ORDER_LINE_PRICE_CHANGE';
