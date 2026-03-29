import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin, loginAsMediaBuyer, navigateTo } from './helpers';

/**
 * E2E Test: Marketing Campaign & Ad Spend Flow
 *
 * Tests campaign creation, funding ledger, and ad spend tracking.
 * Requires seed data: at least one campaign and one media buyer must exist.
 */

test.describe('Marketing Campaign Flow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
  });

  test('marketing overview page loads without errors', async ({ page }) => {
    await navigateTo(page, 'marketing/overview');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).toContainText(/marketing|spend|performance/i);
  });

  test('marketing funding page loads and shows funding table or empty state', async ({ page }) => {
    await page.goto('/admin/marketing/funding');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).not.toContainText(/something went wrong/i);

    const hasTable = await page.locator('table').isVisible().catch(() => false);
    const hasEmptyState = await page.locator('body').getByText(/no funding|empty|no records/i).isVisible().catch(() => false);
    expect(hasTable || hasEmptyState).toBe(true);
  });

  test('marketing orders page loads and shows orders table or empty state', async ({ page }) => {
    await page.goto('/admin/marketing/orders');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).not.toContainText(/something went wrong/i);

    const hasTable = await page.locator('table').isVisible().catch(() => false);
    const hasEmptyState = await page.locator('body').getByText(/no orders|empty|no records/i).isVisible().catch(() => false);
    expect(hasTable || hasEmptyState).toBe(true);
  });

  test('ad spend page loads without errors', async ({ page }) => {
    await page.goto('/admin/marketing/ad-spend');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
  });

  test('forms (campaigns) page loads without errors', async ({ page }) => {
    await page.goto('/admin/marketing/forms');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).toContainText(/form|campaign/i);
  });
});

test.describe('Marketing — Media Buyer view', () => {
  test('media buyer can see own orders page', async ({ page }) => {
    await loginAsMediaBuyer(page);
    await page.goto('/admin/marketing/orders');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).not.toContainText(/unauthorized|forbidden/i);
  });

  test('media buyer cannot see finance COGS data', async ({ page }) => {
    await loginAsMediaBuyer(page);
    await page.goto('/admin/marketing/orders');
    await page.waitForLoadState('networkidle');

    // No cost price values should appear
    const body = await page.locator('body').textContent() ?? '';
    expect(body).not.toMatch(/cost price.*₦\d{3,}/i);
  });
});
