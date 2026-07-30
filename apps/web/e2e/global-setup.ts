/**
 * Playwright Global Setup — runs once before any spec file.
 *
 * Demo/manual DB seed scripts have been removed. E2E specs should rely on
 * existing test DB fixtures or API boot-time catalog sync (permissions /
 * message templates), not `pnpm db:seed`.
 *
 * Required env vars (when login tests need them):
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — SuperAdmin credentials
 */

import type { FullConfig } from '@playwright/test';

async function globalSetup(_config: FullConfig): Promise<void> {
  console.log('[global-setup] No DB seed step (seed scripts removed).');
}

export default globalSetup;
