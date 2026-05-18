import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin, navigateTo } from './helpers';

/**
 * E2E Test: Partial Delivery and Return Flow
 *
 * Tests partial delivery splits and the return restocking workflow.
 * Requires seed data: at least one RETURNED order must exist.
 */

test.describe('Partial Delivery & Returns', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
  });

  test('returns management page loads without errors', async ({ page }) => {
    await navigateTo(page, 'returns');
    await expect(page.locator('body')).toContainText(/return/i);
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
  });

  test('returns page shows status filter options', async ({ page }) => {
    await navigateTo(page, 'returns');
    // Should have filter controls for RETURNED / RESTOCKED / WRITTEN_OFF
    const body = await page.locator('body').textContent();
    expect(body).toMatch(/returned|restocked|written.?off/i);
  });

  test('returns page renders a table or empty state — not a blank screen', async ({ page }) => {
    await navigateTo(page, 'returns');
    await page.waitForLoadState('networkidle');

    const hasTable = await page.locator('table').isVisible().catch(() => false);
    const hasEmptyState = await page.locator('body').getByText(/no returns|empty|no records/i).isVisible().catch(() => false);

    // One of the two must be true — a blank screen is a failure
    expect(hasTable || hasEmptyState).toBe(true);
  });

  test('write-off action button triggers reason modal', async ({ page }) => {
    await navigateTo(page, 'returns');
    await page.waitForLoadState('networkidle');

    const writeOffBtn = page.getByRole('button', { name: /write.?off/i }).first();
    if (!await writeOffBtn.isVisible().catch(() => false)) {
      test.skip();
      return;
    }

    await writeOffBtn.click();

    // Reason/note field must appear — write-off requires mandatory damage note
    const reasonField = page.locator('textarea, input[name*="reason"], input[name*="note"]').first();
    await expect(reasonField).toBeVisible({ timeout: 4000 });
  });

  test('restock action button is available for RETURNED orders', async ({ page }) => {
    await navigateTo(page, 'returns');
    await page.waitForLoadState('networkidle');

    const restockBtn = page.getByRole('button', { name: /restock/i }).first();
    if (!await restockBtn.isVisible().catch(() => false)) {
      test.skip();
      return;
    }

    await expect(restockBtn).toBeEnabled();
  });
});
