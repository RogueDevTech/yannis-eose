-- Revoke users.read from Head of Logistics so they no longer see the HR nav group.
DELETE FROM role_permissions
WHERE role = 'HEAD_OF_LOGISTICS'::user_role
  AND permission_id = (SELECT id FROM permissions WHERE code = 'users.read');
