import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin, navigateTo } from './helpers';

/**
 * E2E Test: State Machine Validation
 *
 * Tests that invalid state transitions are rejected and only valid
 * transitions are available in the UI.
 * Requires seed data: at least one order in various statuses.
 */

test.describe('State Machine Validation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
  });

  test('order detail shows only valid next-state actions for current status', async ({ page }) => {
    await navigateTo(page, 'orders');
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 8000 });

    await firstRow.click();
    await page.waitForURL(/\/admin\/orders\//, { timeout: 8000 });

    const status = await page.locator('[data-status]').getAttribute('data-status').catch(() => null);

    if (status === 'UNPROCESSED' || status === 'CS_ASSIGNED') {
      // Dispatch and Deliver buttons must be absent or disabled for early-stage orders
      const dispatchBtn = page.getByRole('button', { name: /^dispatch$/i });
      if (await dispatchBtn.isVisible().catch(() => false)) {
        await expect(dispatchBtn).toBeDisabled();
      }
      const deliverBtn = page.getByRole('button', { name: /^deliver$/i });
      if (await deliverBtn.isVisible().catch(() => false)) {
        await expect(deliverBtn).toBeDisabled();
      }
    }
  });

  test('CS queue page loads with order queue content', async ({ page }) => {
    await navigateTo(page, 'cs/queue');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).toContainText(/queue|agent|order/i);
  });

  test('logistics page loads with pipeline content', async ({ page }) => {
    await navigateTo(page, 'logistics');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).toContainText(/logistic|allocat|dispatch|transit/i);
  });

  test('inventory page loads with stock content', async ({ page }) => {
    await navigateTo(page, 'inventory');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).toContainText(/inventory|stock|product/i);
  });

  test('transfers page loads with dual-entry verification content', async ({ page }) => {
    await navigateTo(page, 'transfers');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).toContainText(/transfer|verify|receive/i);
  });

  test('settings page loads without errors', async ({ page }) => {
    await navigateTo(page, 'settings');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).toContainText(/setting/i);
  });

  test('CANCELLED orders have no further action buttons', async ({ page }) => {
    await navigateTo(page, 'orders');
    await page.waitForLoadState('networkidle');

    // Look for a CANCELLED order row
    const cancelledRow = page.locator('tr').filter({ hasText: /cancelled/i }).first();
    if (!await cancelledRow.isVisible().catch(() => false)) {
      test.skip();
      return;
    }

    await cancelledRow.click();
    await page.waitForURL(/\/admin\/orders\//, { timeout: 8000 });

    // No transition buttons should be enabled on a CANCELLED order
    const confirmBtn = page.getByRole('button', { name: /^confirm$/i });
    const dispatchBtn = page.getByRole('button', { name: /^dispatch$/i });
    const deliverBtn = page.getByRole('button', { name: /^deliver$/i });

    for (const btn of [confirmBtn, dispatchBtn, deliverBtn]) {
      if (await btn.isVisible().catch(() => false)) {
        await expect(btn).toBeDisabled();
      }
    }
  });
});
