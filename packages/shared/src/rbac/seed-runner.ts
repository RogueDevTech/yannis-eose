import type { Sql } from 'postgres';
import { canonicalPermissionCode } from './permission-codes';
import {
  CANONICAL_PERMISSIONS,
  ROLE_PERMISSIONS,
} from './permission-catalog';

export interface PermissionSeedLogger {
  log: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

export interface PermissionSeedResult {
  permsInserted: number;
  permsTotal: number;
  rolePermsInserted: number;
  rolePermsRevoked: number;
  templatesInserted: number;
  templatePermsInserted: number;
  templatePermsRevoked: number;
  usersRestamped: number;
}

/**
 * Apply the canonical RBAC catalog to the live DB.
 *
 * Idempotent — safe to call on every API boot. Same logic the standalone
 * `db:seed-permissions` CLI runs, extracted so the API's
 * `PermissionSeedService` can keep the live DB in sync without depending on
 * anyone remembering to run a separate command (or being able to reach the
 * DB from an allowlisted IP).
 *
 * Steps:
 *   1. INSERT…ON CONFLICT DO NOTHING for every entry in the canonical
 *      permission catalog. New codes added in source land in the DB on
 *      next boot.
 *   2. Reconcile `role_permissions`: revoke rows that no longer appear in
 *      `ROLE_PERMISSIONS` for that role, then INSERT…ON CONFLICT DO NOTHING
 *      for every grant the catalog declares.
 *   3. Ensure every legacy `user_role` has a SYSTEM `role_templates` row.
 *      (Migration 0093 created the initial set; this re-asserts in case
 *      a new role enum value is added later.)
 *   4. Reconcile `role_template_permissions` for SYSTEM templates against
 *      the same allowed-set the legacy role gets — keeps both code paths
 *      (`roleTemplateId` + legacy `role`) returning identical effective
 *      permissions through `getEffectivePermissions`.
 *
 * Pass a `postgres` `Sql` client (the same one Drizzle wraps in the API,
 * or a fresh one in the CLI). The function does NOT close the client.
 */
export async function applyPermissionCatalog(
  sql: Sql,
  logger?: PermissionSeedLogger,
): Promise<PermissionSeedResult> {
  const log = logger?.log ?? (() => {});

  // ── 1. Bulk-insert any missing permission rows ──────────
  // Single multi-VALUES statement instead of 107 round-trips. `id` uses the
  // table's UUIDv7 default (see `uuidv7Pk()` in db/schema/helpers.ts).
  const permsPayload = CANONICAL_PERMISSIONS.map((p) => ({
    code: p.code,
    resource: p.resource,
    action: p.action,
    description: p.description ?? null,
  }));
  let permsInserted = 0;
  if (permsPayload.length > 0) {
    const insertedPerms = await sql`
      INSERT INTO permissions ${sql(permsPayload, 'code', 'resource', 'action', 'description')}
      ON CONFLICT (code) DO NOTHING
      RETURNING id
    `;
    permsInserted = insertedPerms.length;
  }

  // Build code → id map
  const permRows = await sql<{ id: string; code: string }[]>`SELECT id, code FROM permissions`;
  const permMap = new Map<string, string>();
  for (const p of permRows) {
    permMap.set(p.code, p.id);
  }

  // ── 2. Reconcile role_permissions ──────────────────────
  const roleAllowedPermIds = new Map<string, Set<string>>();
  for (const [role, codes] of Object.entries(ROLE_PERMISSIONS)) {
    if (role === 'SUPER_ADMIN') continue;
    const ids = new Set<string>();
    for (const code of codes) {
      const permId = permMap.get(canonicalPermissionCode(code));
      if (permId) ids.add(permId);
    }
    roleAllowedPermIds.set(role, ids);
  }

  // Bulk-revoke: one DELETE that covers every (role, permission_id) tuple no
  // longer in the catalog. Fast even for large diffs.
  const allRolePerms = await sql<{ role: string; permission_id: string }[]>`
    SELECT rp.role::text AS role, rp.permission_id
    FROM role_permissions rp
  `;
  const rolePermRevocations: { role: string; permissionId: string }[] = [];
  for (const row of allRolePerms) {
    const allowed = roleAllowedPermIds.get(row.role);
    if (allowed && !allowed.has(row.permission_id)) {
      rolePermRevocations.push({ role: row.role, permissionId: row.permission_id });
    }
  }
  let rolePermsRevoked = 0;
  if (rolePermRevocations.length > 0) {
    // postgres.js doesn't accept a 2D array directly inside a tuple `IN`
    // clause (it tries to escape it as identifiers and crashes with
    // `str.replace is not a function`). Group revocations by role and run
    // one DELETE per role with a flat permission-id list — that's a clean
    // `WHERE role = $1 AND permission_id IN ($2, $3, ...)` which postgres.js
    // renders correctly. Revocations are rare so the per-role loop is fine.
    const byRole = new Map<string, string[]>();
    for (const rev of rolePermRevocations) {
      const list = byRole.get(rev.role) ?? [];
      list.push(rev.permissionId);
      byRole.set(rev.role, list);
    }
    for (const [role, permIds] of byRole) {
      const deleted = await sql`
        DELETE FROM role_permissions
        WHERE role::text = ${role}
          AND permission_id IN ${sql(permIds)}
        RETURNING role::text AS role
      `;
      rolePermsRevoked += deleted.length;
    }
  }

  // Bulk-insert: build the full target set of (role, permission_id) tuples,
  // then ON CONFLICT DO NOTHING for the whole batch in one statement.
  // Property names match DB column names (snake_case) — postgres.js does NOT
  // transform identifiers and the DB columns are `role` + `permission_id`.
  const rolePermInserts: { role: string; permission_id: string }[] = [];
  for (const [role, codes] of Object.entries(ROLE_PERMISSIONS)) {
    if (role === 'SUPER_ADMIN') continue;
    for (const code of codes) {
      const permId = permMap.get(canonicalPermissionCode(code));
      if (!permId) continue;
      rolePermInserts.push({ role, permission_id: permId });
    }
  }
  let rolePermsInserted = 0;
  if (rolePermInserts.length > 0) {
    const inserted = await sql`
      INSERT INTO role_permissions ${sql(rolePermInserts, 'role', 'permission_id')}
      ON CONFLICT (role, permission_id) DO NOTHING
      RETURNING role::text AS role
    `;
    rolePermsInserted = inserted.length;
  }

  log(
    `Permissions: ${permsInserted} new / ${CANONICAL_PERMISSIONS.length} total. Role assignments: ${rolePermsInserted} added, ${rolePermsRevoked} revoked.`,
  );

  // ── 3. Ensure SYSTEM role_templates exist ─────────────
  // One bulk insert; ON CONFLICT (key) DO NOTHING handles re-runs.
  const templatePayload = Object.keys(ROLE_PERMISSIONS)
    .filter((roleKey) => roleKey !== 'SUPER_ADMIN')
    .map((roleKey) => ({
      key: `system_${roleKey}`,
      name: roleKey
        .split('_')
        .map((s) => s[0] + s.slice(1).toLowerCase())
        .join(' '),
      kind: 'SYSTEM',
      status: 'ACTIVE',
      locked: true,
      mapped_role: roleKey,
    }));
  let templatesInserted = 0;
  if (templatePayload.length > 0) {
    const insertedTemplates = await sql`
      INSERT INTO role_templates ${sql(
        templatePayload,
        'key',
        'name',
        'kind',
        'status',
        'locked',
        'mapped_role',
      )}
      ON CONFLICT (key) DO NOTHING
      RETURNING id
    `;
    templatesInserted = insertedTemplates.length;
  }

  // ── 4. Reconcile role_template_permissions for SYSTEM templates ──
  const systemTemplates = await sql<{ id: string; mapped_role: string }[]>`
    SELECT id, mapped_role::text AS mapped_role
    FROM role_templates
    WHERE kind = 'SYSTEM' AND mapped_role IS NOT NULL
  `;

  // Build target set keyed on (template_id, permission_id), then diff against
  // current rows in one SELECT, batch-delete strays, batch-insert misses.
  const targetTemplatePerms = new Set<string>();
  const templatePermInserts: { role_template_id: string; permission_id: string }[] = [];
  for (const t of systemTemplates) {
    const allowed = roleAllowedPermIds.get(t.mapped_role);
    if (!allowed) continue;
    for (const permId of allowed) {
      targetTemplatePerms.add(`${t.id}:${permId}`);
      templatePermInserts.push({ role_template_id: t.id, permission_id: permId });
    }
  }

  const currentTemplatePerms = await sql<{ role_template_id: string; permission_id: string }[]>`
    SELECT rtp.role_template_id, rtp.permission_id
    FROM role_template_permissions rtp
    INNER JOIN role_templates rt ON rt.id = rtp.role_template_id
    WHERE rt.kind = 'SYSTEM' AND rt.mapped_role IS NOT NULL AND rtp.valid_to IS NULL
  `;
  const templatePermRevocations: { role_template_id: string; permission_id: string }[] = [];
  for (const row of currentTemplatePerms) {
    if (!targetTemplatePerms.has(`${row.role_template_id}:${row.permission_id}`)) {
      templatePermRevocations.push({
        role_template_id: row.role_template_id,
        permission_id: row.permission_id,
      });
    }
  }

  let templatePermsRevoked = 0;
  if (templatePermRevocations.length > 0) {
    // Same postgres.js gotcha as the role_permissions revoke above — pass a
    // 2D array to a tuple `IN` and it tries to escape it as identifiers,
    // crashing with `str.replace is not a function`. Group by template id
    // and run one DELETE per template with a flat permission-id list.
    const byTemplate = new Map<string, string[]>();
    for (const rev of templatePermRevocations) {
      const list = byTemplate.get(rev.role_template_id) ?? [];
      list.push(rev.permission_id);
      byTemplate.set(rev.role_template_id, list);
    }
    for (const [templateId, permIds] of byTemplate) {
      const deleted = await sql`
        DELETE FROM role_template_permissions
        WHERE role_template_id = ${templateId}
          AND permission_id IN ${sql(permIds)}
        RETURNING role_template_id
      `;
      templatePermsRevoked += deleted.length;
    }
  }

  let templatePermsInserted = 0;
  if (templatePermInserts.length > 0) {
    const inserted = await sql`
      INSERT INTO role_template_permissions ${sql(
        templatePermInserts,
        'role_template_id',
        'permission_id',
      )}
      ON CONFLICT DO NOTHING
      RETURNING role_template_id
    `;
    templatePermsInserted = inserted.length;
  }

  log(
    `SYSTEM templates: ${templatesInserted} new. Template perms: ${templatePermsInserted} added, ${templatePermsRevoked} revoked.`,
  );

  // ── 4. Auto-restamp user_permissions when role grants changed ────
  // When `role_permissions` or template grants changed, existing users of those
  // roles have stale `user_permissions` snapshots. Re-derive and overwrite them
  // so the next request sees the updated effective set — no manual backfill needed.
  let usersRestamped = 0;
  const catalogChanged =
    rolePermsInserted > 0 || rolePermsRevoked > 0 ||
    templatePermsInserted > 0 || templatePermsRevoked > 0;
  if (catalogChanged) {
    // Find all non-SuperAdmin/non-Support users (their perms are computed on
    // the fly from the full catalog, never snapshotted).
    const users: Array<{ id: string; role: string; role_template_id: string | null }> = await sql`
      SELECT id, role::text AS role, role_template_id
      FROM users
      WHERE role NOT IN ('SUPER_ADMIN', 'SUPPORT')
    `;

    for (const u of users) {
      // Collect the effective permission set for this user:
      //   template grants ∪ role_permissions grants ∪ user-level grants − user-level revokes
      const effectiveRows: Array<{ code: string }> = await sql`
        WITH template_perms AS (
          SELECT p.id AS permission_id, p.code
          FROM role_template_permissions rtp
          JOIN permissions p ON p.id = rtp.permission_id
          WHERE rtp.role_template_id = ${u.role_template_id}
        ),
        role_perms AS (
          SELECT p.id AS permission_id, p.code
          FROM role_permissions rp
          JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role = ${u.role}::user_role
        ),
        user_grants AS (
          SELECT p.id AS permission_id, p.code
          FROM user_permissions up
          JOIN permissions p ON p.id = up.permission_id
          WHERE up.user_id = ${u.id}
            AND up.valid_to IS NULL
            AND up.granted = true
        ),
        user_revokes AS (
          SELECT p.id AS permission_id
          FROM user_permissions up
          JOIN permissions p ON p.id = up.permission_id
          WHERE up.user_id = ${u.id}
            AND up.valid_to IS NULL
            AND up.granted = false
        ),
        combined AS (
          SELECT DISTINCT code, permission_id FROM template_perms
          UNION
          SELECT DISTINCT code, permission_id FROM role_perms
          UNION
          SELECT DISTINCT code, permission_id FROM user_grants
        )
        SELECT DISTINCT c.code
        FROM combined c
        WHERE c.permission_id NOT IN (SELECT permission_id FROM user_revokes)
      `;

      const codes = effectiveRows.map((r) => canonicalPermissionCode(r.code));
      const uniqueCodes = [...new Set(codes)];

      // Delete old snapshot, then insert new one.
      await sql`
        DELETE FROM user_permissions
        WHERE user_id = ${u.id}
          AND valid_to IS NULL
      `;
      if (uniqueCodes.length > 0) {
        // Re-insert the derived effective set from the permission IDs.
        await sql`
          INSERT INTO user_permissions (user_id, permission_id, granted)
          SELECT ${u.id}::uuid, p.id, true
          FROM permissions p
          WHERE p.code = ANY(${uniqueCodes})
          ON CONFLICT (user_id, permission_id) WHERE valid_to IS NULL DO NOTHING
        `;
      }
      usersRestamped++;
    }

    log(`User permission snapshots restamped: ${usersRestamped} users.`);
  }

  return {
    permsInserted,
    permsTotal: CANONICAL_PERMISSIONS.length,
    rolePermsInserted,
    rolePermsRevoked,
    templatesInserted,
    templatePermsInserted,
    templatePermsRevoked,
    usersRestamped,
  };
}
