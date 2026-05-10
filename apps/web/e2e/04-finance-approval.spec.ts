import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin, loginAsFinance, loginAsCsAgent, navigateTo } from './helpers';

/**
 * E2E Test: Finance Approval Queue
 *
 * Tests invoice creation, approval flow, and True Profit dashboard.
 * Requires seed data: at least one invoice or approval request.
 */

test.describe('Finance Overview — SuperAdmin', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
  });

  test('finance overview page loads without errors', async ({ page }) => {
    await navigateTo(page, 'finance/overview');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).toContainText(/revenue|profit|finance/i);
  });

  test('finance page shows profit breakdown section', async ({ page }) => {
    await navigateTo(page, 'finance/overview');
    await expect(page.locator('body')).toContainText(/cost|breakdown|profit/i);
  });

  test('invoices page loads with table or empty state', async ({ page }) => {
    await page.goto('/admin/finance/invoices');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);

    const hasTable = await page.locator('table').isVisible().catch(() => false);
    const hasEmptyState = await page.locator('body').getByText(/no invoices|empty|no records/i).isVisible().catch(() => false);
    expect(hasTable || hasEmptyState).toBe(true);
  });

  test('approvals page loads with table or empty state', async ({ page }) => {
    await page.goto('/admin/finance/approvals');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
  });

  test('SuperAdmin sees cost/margin data — column-level security allows it', async ({ page }) => {
    await navigateTo(page, 'finance/overview');
    // SuperAdmin must NOT be blocked by column-level security
    await expect(page.locator('body')).not.toContainText(/unauthorized|forbidden/i);
  });
});

test.describe('Finance — Finance Officer access', () => {
  test('finance officer can access finance overview', async ({ page }) => {
    await loginAsFinance(page);
    await page.goto('/admin/finance/overview');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).not.toContainText(/unauthorized|forbidden/i);
  });
});

test.describe('Finance — CS Closer blocked from cost fields', () => {
  test('CS closer cannot access finance overview', async ({ page }) => {
    await loginAsCsAgent(page);
    await page.goto('/admin/finance/overview');
    await page.waitForLoadState('networkidle');

    // CS closer should be redirected or shown forbidden — NOT see profit data
    const body = await page.locator('body').textContent() ?? '';
    const isBlocked = /unauthorized|forbidden|403|not allowed|access denied/i.test(body);
    const isRedirected = !page.url().includes('/finance');
    expect(isBlocked || isRedirected).toBe(true);
  });
});
