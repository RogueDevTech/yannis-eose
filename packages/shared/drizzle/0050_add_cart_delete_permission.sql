-- Add cart.delete permission and grant it to HEAD_OF_CS only.
-- SuperAdmin bypasses all permission checks at the procedure level.

INSERT INTO permissions (id, code, resource, action, description)
VALUES (gen_random_uuid(), 'cart.delete', 'cart', 'delete', 'Delete abandoned cart entries')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'HEAD_OF_CS', id FROM permissions WHERE code = 'cart.delete'
ON CONFLICT DO NOTHING;
