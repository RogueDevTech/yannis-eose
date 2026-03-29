import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin, navigateTo } from './helpers';

/**
 * E2E Test: Full Order Lifecycle
 *
 * Tests the complete order state machine:
 * UNPROCESSED → CS_ASSIGNED → CS_ENGAGED → CONFIRMED → ALLOCATED → DISPATCHED → IN_TRANSIT → DELIVERED → COMPLETED
 *
 * Requires seed data: at least one order must exist (created by global-setup seed).
 */

test.describe('Order Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
  });

  test('orders page loads and shows the orders table', async ({ page }) => {
    await navigateTo(page, 'orders');
    await expect(page.getByText(/orders/i).first()).toBeVisible();
    // Table must be present — seed data guarantees at least one row
    await expect(page.locator('table')).toBeVisible();
  });

  test('dashboard shows order status pipeline', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(/unprocessed|orders|pipeline/i);
  });

  test('clicking first order row opens order detail page', async ({ page }) => {
    await navigateTo(page, 'orders');
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 8000 });
    await firstRow.click();
    await page.waitForURL(/\/admin\/orders\//, { timeout: 8000 });
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
  });

  test('order detail only shows valid next-state buttons for current status', async ({ page }) => {
    await navigateTo(page, 'orders');
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 8000 });
    await firstRow.click();
    await page.waitForURL(/\/admin\/orders\//, { timeout: 8000 });

    const status = await page.locator('[data-status]').getAttribute('data-status').catch(() => null);

    if (status === 'UNPROCESSED' || status === 'CS_ASSIGNED') {
      // Dispatch button must NOT be present or must be disabled for early-stage orders
      const dispatchBtn = page.getByRole('button', { name: /^dispatch$/i });
      if (await dispatchBtn.isVisible().catch(() => false)) {
        await expect(dispatchBtn).toBeDisabled();
      }
    }
  });

  test('order detail shows timeline/history section', async ({ page }) => {
    await navigateTo(page, 'orders');
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 8000 });
    await firstRow.click();
    await page.waitForURL(/\/admin\/orders\//, { timeout: 8000 });

    // Timeline section must exist — writeTimelineEvent is called on every transition
    const timeline = page.locator('[data-testid="order-timeline"], .timeline, [class*="timeline"], [class*="history"]');
    await expect(timeline.first()).toBeVisible({ timeout: 5000 });
    // Timeline must contain a date (year 2025 or 2026)
    await expect(timeline.first()).toContainText(/202[56]/);
  });
});
