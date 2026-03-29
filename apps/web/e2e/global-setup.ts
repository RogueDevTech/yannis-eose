/**
 * Playwright Global Setup — runs once before any spec file.
 *
 * Seeds the yannis_test database with deterministic test accounts
 * so all E2E specs can rely on known data instead of conditional guards.
 *
 * Required env vars:
 *   TEST_DATABASE_URL or DATABASE_URL — points to yannis_test DB
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — SuperAdmin credentials for login tests
 */

import type { FullConfig } from '@playwright/test';

async function globalSetup(_config: FullConfig): Promise<void> {
  // If no DB configured, skip seeding (CI will configure it)
  const dbUrl = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!dbUrl) {
    console.log('[global-setup] No TEST_DATABASE_URL — skipping E2E seed.');
    return;
  }

  console.log('[global-setup] Running E2E seed against test DB...');

  const { execSync } = await import('child_process');
  try {
    execSync('pnpm --filter @yannis/shared db:seed', {
      stdio: 'inherit',
      // Explicitly override DATABASE_URL so seed always targets the test DB,
      // never the production/dev Aiven DB from root .env
      env: { ...process.env, DATABASE_URL: dbUrl },
      cwd: process.cwd(),
    });
    console.log('[global-setup] Seed complete.');
  } catch (err) {
    // Seed failure should not block tests — data may already exist
    console.warn('[global-setup] Seed failed or partially ran:', (err as Error).message);
  }
}

export default globalSetup;
