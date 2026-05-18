-- Allow catalog archive requests pending Super Admin approval (soft-remove via status ARCHIVED).
ALTER TYPE "permission_request_type" ADD VALUE IF NOT EXISTS 'PRODUCT_ARCHIVE';
