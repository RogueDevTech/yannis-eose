import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { withActor } from '../src/common/db/with-actor';

for (const envPath of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '..', '.env'),
  resolve(process.cwd(), 'apps/api/.env'),
]) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: true });
  }
}

type PendingPermissionRequestRow = {
  id: string;
  type: 'USER_CREATION' | 'ROLE_CHANGE';
  requesterId: string;
  targetUserId: string | null;
  requestedRole: string | null;
  payload: unknown;
  createdAt: Date | string;
};

function getArgValue(name: string): string | undefined {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const idx = process.argv.findIndex((arg) => arg === name);
  if (idx >= 0) return process.argv[idx + 1];
  return undefined;
}

function extractUserCreationKey(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { email?: unknown; phone?: unknown };
  const email =
    typeof record.email === 'string' && record.email.trim().length > 0
      ? record.email.trim().toLowerCase()
      : null;
  if (email) return `USER_CREATION:${email}`;
  const phone =
    typeof record.phone === 'string' && record.phone.trim().length > 0
      ? record.phone.trim()
      : null;
  return phone ? `USER_CREATION:phone:${phone}` : null;
}

function extractDuplicateKey(row: PendingPermissionRequestRow): string | null {
  if (row.type === 'ROLE_CHANGE') {
    return row.targetUserId ? `ROLE_CHANGE:${row.targetUserId}` : null;
  }
  return extractUserCreationKey(row.payload);
}

function printGroup(rows: PendingPermissionRequestRow[]): void {
  const [keeper, ...duplicates] = rows;
  console.warn(
    `[cleanup-duplicate-permission-requests] keep ${keeper.id} (${keeper.type} · ${String(
      keeper.createdAt,
    )})`,
  );
  for (const row of duplicates) {
    console.warn(
      `  reject ${row.id} (${row.type} · ${String(row.createdAt)} · requestedRole=${row.requestedRole ?? '—'})`,
    );
  }
}

async function resolveCleanupActorId(
  db: ReturnType<typeof drizzle<typeof schema>>,
): Promise<string> {
  const explicit = getArgValue('--actor-id');
  if (explicit?.trim()) return explicit.trim();

  const superAdmins = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(and(eq(schema.users.role, 'SUPER_ADMIN'), isNull(schema.users.validTo)));

  if (superAdmins.length === 1) {
    const actor = superAdmins[0]!;
    console.warn(
      `[cleanup-duplicate-permission-requests] using sole SUPER_ADMIN as actor: ${actor.name ?? 'Unknown'} <${actor.email}> (${actor.id})`,
    );
    return actor.id;
  }

  console.error(
    '[cleanup-duplicate-permission-requests] Could not resolve a single SUPER_ADMIN actor automatically. Re-run with --actor-id=<uuid>.',
  );
  for (const actor of superAdmins) {
    console.error(`  - ${actor.id} · ${actor.name ?? 'Unknown'} <${actor.email}>`);
  }
  process.exit(1);
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url?.trim()) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }

  const apply = process.argv.includes('--apply');
  const sqlPg = postgres(url, {
    max: 3,
    idle_timeout: 10,
    connect_timeout: 30,
    ssl: { rejectUnauthorized: false },
  });
  const db = drizzle(sqlPg, { schema });

  try {
    const pendingRows = await db
      .select({
        id: schema.permissionRequests.id,
        type: schema.permissionRequests.type,
        requesterId: schema.permissionRequests.requesterId,
        targetUserId: schema.permissionRequests.targetUserId,
        requestedRole: schema.permissionRequests.requestedRole,
        payload: schema.permissionRequests.payload,
        createdAt: schema.permissionRequests.createdAt,
      })
      .from(schema.permissionRequests)
      .where(
        and(
          eq(schema.permissionRequests.status, 'PENDING'),
          inArray(schema.permissionRequests.type, ['USER_CREATION', 'ROLE_CHANGE']),
        ),
      )
      .orderBy(asc(schema.permissionRequests.createdAt), asc(schema.permissionRequests.id));

    const groups = new Map<string, PendingPermissionRequestRow[]>();
    for (const row of pendingRows) {
      const key = extractDuplicateKey(row as PendingPermissionRequestRow);
      if (!key) continue;
      const existing = groups.get(key);
      if (existing) existing.push(row as PendingPermissionRequestRow);
      else groups.set(key, [row as PendingPermissionRequestRow]);
    }

    const duplicateGroups = [...groups.values()]
      .map((rows) =>
        [...rows].sort((a, b) => {
          const aTime = new Date(a.createdAt).getTime();
          const bTime = new Date(b.createdAt).getTime();
          if (aTime !== bTime) return aTime - bTime;
          return a.id.localeCompare(b.id);
        }),
      )
      .filter((rows) => rows.length > 1);

    if (duplicateGroups.length === 0) {
      console.warn('[cleanup-duplicate-permission-requests] No duplicate pending USER_CREATION / ROLE_CHANGE groups found.');
      return;
    }

    console.warn(
      `[cleanup-duplicate-permission-requests] Found ${duplicateGroups.length} duplicate group(s).`,
    );
    for (const rows of duplicateGroups) {
      printGroup(rows);
    }

    if (!apply) {
      console.warn('[cleanup-duplicate-permission-requests] Dry run only. Re-run with --apply to reject newer duplicates.');
      return;
    }

    const actorId = await resolveCleanupActorId(db);
    const duplicateRows = duplicateGroups.flatMap((rows) => rows.slice(1));
    const reason =
      'Auto-cleanup: rejected newer duplicate pending request so the oldest pending request remains the canonical audit row.';

    await withActor(db as never, { id: actorId }, async (tx) => {
      for (const row of duplicateRows) {
        await tx
          .update(schema.permissionRequests)
          .set({
            status: 'REJECTED',
            approverId: actorId,
            approvalReason: reason,
            approvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.permissionRequests.id, row.id));
      }
    });

    console.warn(
      `[cleanup-duplicate-permission-requests] Rejected ${duplicateRows.length} duplicate pending row(s).`,
    );
  } finally {
    await sqlPg.end({ timeout: 15 });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
