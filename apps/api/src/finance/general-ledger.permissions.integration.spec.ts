/**
 * Integration tests: general-ledger PERMISSION gates.
 *
 * These verify the two things unit/service tests miss:
 *   1. The tRPC permissionProcedure gates actually enforce access on the
 *      generalLedger router (allow with the right code, FORBIDDEN without,
 *      SUPER_ADMIN/SUPPORT bypass).
 *   2. The new finance.ledger.* codes really flow to a FINANCE_OFFICER at
 *      runtime — i.e. applyPermissionCatalog() seeds them and
 *      computeEffectivePermissionsLegacyUnion() returns them for a real user.
 *
 * Run against a migrated yannis_test DB (see setup-integration.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { getPgClient, getDb, closeConnections } from '../test/setup-integration';
import { createTestUser } from '../test/factories/order.factory';
import { applyPermissionCatalog } from '../../../../packages/shared/src/rbac/seed-runner';
import { computeEffectivePermissionsLegacyUnion } from '../permissions/permissions.service';
import { generalLedgerRouter, setGeneralLedgerService } from '../trpc/routers/general-ledger.router';
import { GeneralLedgerService } from './general-ledger.service';
import type { TrpcContext } from '../trpc/context';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('General Ledger — Permission Gates (Integration)', () => {
  const pgClient = getPgClient();
  const db = getDb();

  beforeAll(async () => {
    // Wire the service singleton the router calls through.
    setGeneralLedgerService(new GeneralLedgerService(db as never));
    // Seed the RBAC catalog so role_permissions / role_template_permissions
    // reflect the current ROLE_PERMISSIONS map (incl. finance.ledger.*).
    await applyPermissionCatalog(pgClient as never);
  });

  afterAll(async () => {
    await closeConnections();
  });

  function buildCtx(user: Partial<TrpcContext['user']> & { id: string; role: string }): TrpcContext {
    return {
      user: {
        email: `${user.id}@yannis.test`,
        name: 'Test',
        logisticsLocationId: null,
        permissions: [],
        currentBranchId: null,
        mirroredBy: null,
        mirrorSessionId: null,
        ...user,
      },
      req: {} as TrpcContext['req'],
      res: {} as TrpcContext['res'],
      sessionToken: null,
      currentBranchId: null,
      effectiveBranchIds: null,
      activeGroupId: null,
    } as TrpcContext;
  }

  // ── Layer 1: the gate logic on the real router ───────────────────────────────

  it('allows a caller holding finance.ledger.read to query', async () => {
    const caller = generalLedgerRouter.createCaller(
      buildCtx({ id: '00000000-0000-0000-0000-000000000001', role: 'FINANCE_OFFICER', permissions: ['finance.ledger.read'] }),
    );
    await expect(caller.listAccounts({ groupId: null, includeInactive: false })).resolves.toBeDefined();
  });

  it('blocks a caller with no ledger permission (FORBIDDEN)', async () => {
    const caller = generalLedgerRouter.createCaller(
      buildCtx({ id: '00000000-0000-0000-0000-000000000002', role: 'MEDIA_BUYER', permissions: ['orders.read'] }),
    );
    await expect(caller.listAccounts({ groupId: null, includeInactive: false })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('blocks a read-only caller from a write procedure', async () => {
    const caller = generalLedgerRouter.createCaller(
      buildCtx({ id: '00000000-0000-0000-0000-000000000003', role: 'FINANCE_OFFICER', permissions: ['finance.ledger.read'] }),
    );
    await expect(
      caller.createFiscalYear({ groupId: null, name: '2027', startDate: '2027-01-01', endDate: '2027-12-31' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows a write when the caller holds finance.ledger.write', async () => {
    const caller = generalLedgerRouter.createCaller(
      buildCtx({
        id: '00000000-0000-0000-0000-000000000004',
        role: 'FINANCE_OFFICER',
        permissions: ['finance.ledger.read', 'finance.ledger.write'],
      }),
    );
    // Reads through to the service; a listFiscalYears is a safe write-gated? No —
    // use a read-gated call that needs write is not applicable. Assert the gate
    // passes by reaching the service (no FORBIDDEN thrown).
    await expect(
      caller.createFiscalYear({ groupId: null, name: '2099', startDate: '2099-01-01', endDate: '2099-12-31' }),
    ).resolves.toBeDefined();
  });

  it('SUPER_ADMIN bypasses the gate even with no explicit permissions', async () => {
    const caller = generalLedgerRouter.createCaller(
      buildCtx({ id: '00000000-0000-0000-0000-000000000005', role: 'SUPER_ADMIN', permissions: [] }),
    );
    await expect(caller.listAccounts({ groupId: null, includeInactive: false })).resolves.toBeDefined();
  });

  // ── Layer 2: the catalog actually grants the codes to the right roles ─────────

  it('FINANCE_OFFICER resolves finance.ledger.read + write from the seeded catalog', async () => {
    const fo = await createTestUser(db as never, { role: 'FINANCE_OFFICER' });
    const perms = await computeEffectivePermissionsLegacyUnion(db as never, fo.id);
    expect(perms.has('finance.ledger.read')).toBe(true);
    expect(perms.has('finance.ledger.write')).toBe(true);
    expect(perms.has('finance.ledger.export')).toBe(true);
  });

  it('a non-finance role does NOT resolve finance.ledger.* codes', async () => {
    const mb = await createTestUser(db as never, { role: 'MEDIA_BUYER' });
    const perms = await computeEffectivePermissionsLegacyUnion(db as never, mb.id);
    expect(perms.has('finance.ledger.read')).toBe(false);
    expect(perms.has('finance.ledger.write')).toBe(false);
  });

  it('SUPER_ADMIN resolves all codes incl. finance.ledger.*', async () => {
    const sa = await createTestUser(db as never, { role: 'SUPER_ADMIN' });
    const perms = await computeEffectivePermissionsLegacyUnion(db as never, sa.id);
    expect(perms.has('finance.ledger.read')).toBe(true);
    expect(perms.has('finance.ledger.write')).toBe(true);
  });

  // ── Layer 3: real resolved perms drive the real gate ──────────────────────────

  it('end-to-end: a real FINANCE_OFFICER (resolved perms) passes the router gate', async () => {
    const fo = await createTestUser(db as never, { role: 'FINANCE_OFFICER' });
    const perms = Array.from(await computeEffectivePermissionsLegacyUnion(db as never, fo.id));
    const caller = generalLedgerRouter.createCaller(
      buildCtx({ id: fo.id, role: 'FINANCE_OFFICER', permissions: perms }),
    );
    await expect(caller.listJournalEntries({ groupId: null, page: 1, limit: 50 })).resolves.toBeDefined();
  });

  it('end-to-end: a real MEDIA_BUYER (resolved perms) is blocked by the router gate', async () => {
    const mb = await createTestUser(db as never, { role: 'MEDIA_BUYER' });
    const perms = Array.from(await computeEffectivePermissionsLegacyUnion(db as never, mb.id));
    const caller = generalLedgerRouter.createCaller(
      buildCtx({ id: mb.id, role: 'MEDIA_BUYER', permissions: perms }),
    );
    await expect(caller.listJournalEntries({ groupId: null, page: 1, limit: 50 })).rejects.toBeInstanceOf(TRPCError);
  });
});
