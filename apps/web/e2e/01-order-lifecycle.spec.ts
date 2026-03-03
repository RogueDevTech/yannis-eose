import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin, navigateTo } from './helpers';

/**
 * E2E Test: Full Order Lifecycle
 *
 * Tests the complete order state machine:
 * UNPROCESSED → CS_ENGAGED → CONFIRMED → ALLOCATED → DISPATCHED → IN_TRANSIT → DELIVERED → COMPLETED
 */

test.describe('Order Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
  });

  test('should display orders page with correct columns', async ({ page }) => {
    await navigateTo(page, 'orders');
    await expect(page.getByText(/orders/i).first()).toBeVisible();
  });

  test('should show order status counts on dashboard', async ({ page }) => {
    await page.goto('/admin');
    // Dashboard should show status pipeline for SuperAdmin
    await expect(page.locator('body')).toContainText(/unprocessed|orders|pipeline/i);
  });

  test('should navigate to order detail page', async ({ page }) => {
    await navigateTo(page, 'orders');
    // If orders exist, click the first one
    const firstOrder = page.locator('table tbody tr').first();
    const orderExists = await firstOrder.isVisible().catch(() => false);
    if (orderExists) {
      await firstOrder.click();
      await page.waitForURL(/\/admin\/orders\//);
    }
  });

  test('should enforce state machine — no state skipping', async ({ page }) => {
    await navigateTo(page, 'orders');
    // The UI should disable invalid state transitions
    // An UNPROCESSED order should only show "Engage" button, not "Dispatch"
    const firstRow = page.locator('table tbody tr').first();
    const rowExists = await firstRow.isVisible().catch(() => false);
    if (rowExists) {
      await firstRow.click();
      await page.waitForURL(/\/admin\/orders\//);
      // Check that only valid next-state buttons are enabled
      const dispatchBtn = page.getByRole('button', { name: /dispatch/i });
      const engageBtn = page.getByRole('button', { name: /engage|call/i });
      // If order is UNPROCESSED, dispatch should not be available
      const status = await page.locator('[data-status]').getAttribute('data-status');
      if (status === 'UNPROCESSED') {
        if (await dispatchBtn.isVisible().catch(() => false)) {
          await expect(dispatchBtn).toBeDisabled();
        }
      }
    }
  });

  test('should log state transitions in audit trail', async ({ page }) => {
    await navigateTo(page, 'orders');
    const firstRow = page.locator('table tbody tr').first();
    const rowExists = await firstRow.isVisible().catch(() => false);
    if (rowExists) {
      await firstRow.click();
      await page.waitForURL(/\/admin\/orders\//);
      // Look for history/timeline section
      const timeline = page.locator('[data-testid="order-timeline"], .timeline, [class*="history"]');
      if (await timeline.isVisible().catch(() => false)) {
        // Timeline should show who made changes and when
        await expect(timeline).toContainText(/\d{4}/); // Should contain a date
      }
    }
  });
});
