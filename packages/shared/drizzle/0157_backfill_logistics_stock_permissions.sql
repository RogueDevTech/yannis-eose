-- Migration 0157: Backfill new permissions for HEAD_OF_LOGISTICS and STOCK_MANAGER
--
-- HEAD_OF_LOGISTICS gets: finance.read
-- STOCK_MANAGER gets: logistics.read, orders.read
--
-- Inserts into user_permissions for existing users of these roles,
-- skipping any that already have the grant.

-- HEAD_OF_LOGISTICS → finance.read
INSERT INTO user_permissions (id, user_id, permission_id, granted, granted_by, created_at, valid_from)
SELECT
  gen_random_uuid(),
  u.id,
  p.id,
  true,
  NULL,
  now(),
  now()
FROM users u
CROSS JOIN permissions p
WHERE u.role = 'HEAD_OF_LOGISTICS'
  AND u.deleted_at IS NULL
  AND p.code = 'finance.read'
  AND NOT EXISTS (
    SELECT 1 FROM user_permissions up
    WHERE up.user_id = u.id
      AND up.permission_id = p.id
      AND up.valid_to IS NULL
  );

-- STOCK_MANAGER → logistics.read
INSERT INTO user_permissions (id, user_id, permission_id, granted, granted_by, created_at, valid_from)
SELECT
  gen_random_uuid(),
  u.id,
  p.id,
  true,
  NULL,
  now(),
  now()
FROM users u
CROSS JOIN permissions p
WHERE u.role = 'STOCK_MANAGER'
  AND u.deleted_at IS NULL
  AND p.code = 'logistics.read'
  AND NOT EXISTS (
    SELECT 1 FROM user_permissions up
    WHERE up.user_id = u.id
      AND up.permission_id = p.id
      AND up.valid_to IS NULL
  );

-- STOCK_MANAGER → orders.read
INSERT INTO user_permissions (id, user_id, permission_id, granted, granted_by, created_at, valid_from)
SELECT
  gen_random_uuid(),
  u.id,
  p.id,
  true,
  NULL,
  now(),
  now()
FROM users u
CROSS JOIN permissions p
WHERE u.role = 'STOCK_MANAGER'
  AND u.deleted_at IS NULL
  AND p.code = 'orders.read'
  AND NOT EXISTS (
    SELECT 1 FROM user_permissions up
    WHERE up.user_id = u.id
      AND up.permission_id = p.id
      AND up.valid_to IS NULL
  );
