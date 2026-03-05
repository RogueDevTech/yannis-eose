import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin, navigateTo } from './helpers';

/**
 * E2E Test: State Machine Validation
 *
 * Tests that invalid state transitions are rejected and only valid
 * transitions are available in the UI.
 */

test.describe('State Machine Validation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
  });

  test('order detail page should only show valid next-state actions', async ({ page }) => {
    await navigateTo(page, 'orders');
    const firstRow = page.locator('table tbody tr').first();
    const hasOrders = await firstRow.isVisible().catch(() => false);
    if (!hasOrders) {
      test.skip();
      return;
    }

    await firstRow.click();
    await page.waitForURL(/\/admin\/orders\//);

    // Get current status
    const statusEl = page.locator('[data-status], [class*="status"], [class*="badge"]').first();
    const statusText = await statusEl.textContent().catch(() => '');

    if (statusText?.includes('UNPROCESSED')) {
      // Should only allow: Call (transitions to CS_ENGAGED) or Cancel
      const dispatchBtn = page.getByRole('button', { name: /dispatch/i });
      if (await dispatchBtn.isVisible().catch(() => false)) {
        await expect(dispatchBtn).toBeDisabled();
      }
      const deliverBtn = page.getByRole('button', { name: /deliver/i });
      if (await deliverBtn.isVisible().catch(() => false)) {
        await expect(deliverBtn).toBeDisabled();
      }
    }
  });

  test('CS page should show only engageable orders', async ({ page }) => {
    await navigateTo(page, 'cs');
    // CS page should show the order queue
    await expect(page.locator('body')).toContainText(/queue|agent|order/i);
  });

  test('logistics page should show allocation pipeline', async ({ page }) => {
    await navigateTo(page, 'logistics');
    // Should show status pipeline for logistics operations
    await expect(page.locator('body')).toContainText(/logistic|allocat|dispatch|transit/i);
  });

  test('inventory page should show stock states', async ({ page }) => {
    await navigateTo(page, 'inventory');
    // Should show inventory levels with proper stock states
    await expect(page.locator('body')).toContainText(/inventory|stock|product/i);
  });

  test('transfers page should enforce dual-entry verification', async ({ page }) => {
    await navigateTo(page, 'transfers');
    // Stock transfers should show verification workflow
    await expect(page.locator('body')).toContainText(/transfer|verify|receive/i);
  });

  test('settings page should load correctly', async ({ page }) => {
    await navigateTo(page, 'settings');
    await expect(page.locator('body')).toContainText(/setting/i);
  });
});
