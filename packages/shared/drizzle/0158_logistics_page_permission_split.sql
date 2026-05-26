-- Migration 0158: Split logistics.read / transfers.read into page-scoped slices.
--
-- New canonical permission codes:
--   logistics.providers.view          — only the "Logistics companies" page
--   logistics.partner_transfers.view  — only the "Partner stock transfers" page
--
-- CEO directive 2026-05-26: the umbrella logistics.read / transfers.read codes
-- gate ~10 surfaces at once (Logistics companies, Logistics orders, TPL orders,
-- riders, remittances, delivery confirmations, shrinkage / stuck / health
-- dashboards, internal /admin/transfers). There was no way to grant just the
-- two pages without dragging the rest along. These page-scoped slices fix that.
--
-- This migration is PURELY ADDITIVE — it INSERTs new permission rows and
-- grants, but NEVER UPDATEs or DELETEs an existing row. Any custom user
-- permission (e.g. a CS_CLOSER deputized with finance.read, or a manual
-- per-user grant of any other code) is left exactly as it was. Every INSERT
-- is guarded by `ON CONFLICT DO NOTHING` or a `NOT EXISTS` check.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Insert the two new canonical permission codes into the catalog.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (code, resource, action, description)
VALUES
  (
    'logistics.providers.view',
    'logistics.providers',
    'view',
    'View the Logistics companies page (3PL partner directory) — page-scoped slice of logistics.read.'
  ),
  (
    'logistics.partner_transfers.view',
    'logistics.partner_transfers',
    'view',
    'View the Partner stock transfers page (3PL transfer ledger) — page-scoped slice of transfers.read.'
  )
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Grant the new codes via role_permissions for the four roles that
--    currently see these pages today. Preserves existing umbrella grants.
--
--    BRANCH_ADMIN gets logistics.providers.view only (never held transfers.read,
--    so does not gain Partner stock transfers visibility from this migration).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (role, permission_id)
SELECT 'BRANCH_ADMIN'::user_role, p.id
FROM permissions p
WHERE p.code = 'logistics.providers.view'
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'HEAD_OF_LOGISTICS'::user_role, p.id
FROM permissions p
WHERE p.code IN ('logistics.providers.view', 'logistics.partner_transfers.view')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'STOCK_MANAGER'::user_role, p.id
FROM permissions p
WHERE p.code IN ('logistics.providers.view', 'logistics.partner_transfers.view')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'TPL_MANAGER'::user_role, p.id
FROM permissions p
WHERE p.code IN ('logistics.providers.view', 'logistics.partner_transfers.view')
ON CONFLICT (role, permission_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Grant the new codes via SYSTEM role_template_permissions, so users on
--    the standard role templates pick up the codes through the template path
--    as well as via role_permissions.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO role_template_permissions (role_template_id, permission_id)
SELECT rt.id, p.id
FROM role_templates rt
CROSS JOIN permissions p
WHERE rt.kind = 'SYSTEM'
  AND rt.mapped_role = 'BRANCH_ADMIN'::user_role
  AND p.code = 'logistics.providers.view'
ON CONFLICT (role_template_id, permission_id) DO NOTHING;

INSERT INTO role_template_permissions (role_template_id, permission_id)
SELECT rt.id, p.id
FROM role_templates rt
CROSS JOIN permissions p
WHERE rt.kind = 'SYSTEM'
  AND rt.mapped_role IN (
    'HEAD_OF_LOGISTICS'::user_role,
    'STOCK_MANAGER'::user_role,
    'TPL_MANAGER'::user_role
  )
  AND p.code IN ('logistics.providers.view', 'logistics.partner_transfers.view')
ON CONFLICT (role_template_id, permission_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Backfill user_permissions for ACTIVE users who hold the umbrella code
--    through ANY effective source (role_permissions, role_template_permissions,
--    OR a direct user-level grant), and don't yet have an active row for the
--    new page-scoped code. INSERT-only — never modifies, never deletes.
--
--    Why backfill user_permissions when the role / template grants in (2)+(3)
--    already cover the standard templates? Two reasons:
--      • Custom roles (admin-cloned templates) may have user-level grants of
--        the umbrella code without the template carrying it. Detecting the
--        umbrella in any source keeps those users visible.
--      • The session-builder reads from user_permissions directly for the
--        per-user effective snapshot — writing the row makes the grant visible
--        immediately on next session refresh, without waiting for the boot
--        seed runner to re-derive the snapshot.
-- ─────────────────────────────────────────────────────────────────────────────

-- 4a) Effective holders of logistics.overview.view → also receive logistics.providers.view.
INSERT INTO user_permissions (user_id, permission_id, granted, granted_by, created_at, valid_from)
SELECT DISTINCT u.id, target.id, true, NULL::uuid, now(), now()
FROM users u
CROSS JOIN permissions target
WHERE u.status = 'ACTIVE'
  AND target.code = 'logistics.providers.view'
  AND EXISTS (
    SELECT 1
    FROM permissions src
    WHERE src.code = 'logistics.overview.view'
      AND (
        EXISTS (
          SELECT 1 FROM role_permissions rp
          WHERE rp.role = u.role
            AND rp.permission_id = src.id
        )
        OR (
          u.role_template_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM role_template_permissions rtp
            WHERE rtp.role_template_id = u.role_template_id
              AND rtp.permission_id = src.id
              AND rtp.valid_to IS NULL
          )
        )
        OR EXISTS (
          SELECT 1 FROM user_permissions up
          WHERE up.user_id = u.id
            AND up.permission_id = src.id
            AND up.granted = true
            AND up.valid_to IS NULL
        )
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM user_permissions up
    WHERE up.user_id = u.id
      AND up.permission_id = target.id
      AND up.valid_to IS NULL
  );

-- 4b) Effective holders of inventory.transfers.view → also receive logistics.partner_transfers.view.
INSERT INTO user_permissions (user_id, permission_id, granted, granted_by, created_at, valid_from)
SELECT DISTINCT u.id, target.id, true, NULL::uuid, now(), now()
FROM users u
CROSS JOIN permissions target
WHERE u.status = 'ACTIVE'
  AND target.code = 'logistics.partner_transfers.view'
  AND EXISTS (
    SELECT 1
    FROM permissions src
    WHERE src.code = 'inventory.transfers.view'
      AND (
        EXISTS (
          SELECT 1 FROM role_permissions rp
          WHERE rp.role = u.role
            AND rp.permission_id = src.id
        )
        OR (
          u.role_template_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM role_template_permissions rtp
            WHERE rtp.role_template_id = u.role_template_id
              AND rtp.permission_id = src.id
              AND rtp.valid_to IS NULL
          )
        )
        OR EXISTS (
          SELECT 1 FROM user_permissions up
          WHERE up.user_id = u.id
            AND up.permission_id = src.id
            AND up.granted = true
            AND up.valid_to IS NULL
        )
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM user_permissions up
    WHERE up.user_id = u.id
      AND up.permission_id = target.id
      AND up.valid_to IS NULL
  );
