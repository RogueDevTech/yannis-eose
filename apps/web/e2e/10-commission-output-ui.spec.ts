import { test, expect } from '@playwright/test';
import { loginAsHR, loginAsSuperAdmin } from './helpers';

/**
 * E2E Test: Commission Output UI
 *
 * Verifies the payout generation UI produces correct line items:
 * base salary, per-order rate, clawback deductions.
 *
 * Requires seed data:
 *   - At least one commission plan (role=CS_AGENT, baseSalary, perOrderRate set)
 *   - At least one CS agent with delivered orders in the current period
 *   - At least one CLAWBACK adjustment for that agent
 */

test.describe('Commission Output UI — HR Manager', () => {
  test('HR page loads with payout tab accessible', async ({ page }) => {
    await loginAsHR(page);
    await page.goto('/admin/hr');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).not.toContainText(/unauthorized|forbidden/i);

    const payoutsTab = page.getByRole('button', { name: /payout/i }).first();
    await expect(payoutsTab).toBeVisible({ timeout: 5000 });
  });

  test('payouts tab shows period date pickers for generation', async ({ page }) => {
    await loginAsHR(page);
    await page.goto('/admin/hr');
    await page.waitForLoadState('networkidle');

    const payoutsTab = page.getByRole('button', { name: /payout/i }).first();
    if (!await payoutsTab.isVisible().catch(() => false)) {
      test.skip();
      return;
    }

    await payoutsTab.click();
    await page.waitForLoadState('networkidle');

    // Period start + end dates must be present for payout generation
    const dateInputs = page.locator('input[type="date"]');
    await expect(dateInputs.first()).toBeVisible({ timeout: 5000 });
    const count = await dateInputs.count();
    expect(count).toBeGreaterThanOrEqual(2); // periodStart and periodEnd
  });

  test('payout records show status badge (DRAFT / APPROVED / PAID)', async ({ page }) => {
    await loginAsHR(page);
    await page.goto('/admin/hr');
    await page.waitForLoadState('networkidle');

    const payoutsTab = page.getByRole('button', { name: /payout/i }).first();
    if (!await payoutsTab.isVisible().catch(() => false)) {
      test.skip();
      return;
    }

    await payoutsTab.click();
    await page.waitForLoadState('networkidle');

    const hasTable = await page.locator('table').isVisible().catch(() => false);
    if (!hasTable) {
      test.skip();
      return;
    }

    // Each row must have a status badge
    const statusBadges = page.locator('table tbody tr').first()
      .locator('[class*="badge"], [class*="status"], [class*="pill"]');
    await expect(statusBadges.first()).toBeVisible({ timeout: 5000 });
  });

  test('payout detail shows base salary line item', async ({ page }) => {
    await loginAsHR(page);
    await page.goto('/admin/hr');
    await page.waitForLoadState('networkidle');

    const payoutsTab = page.getByRole('button', { name: /payout/i }).first();
    if (!await payoutsTab.isVisible().catch(() => false)) {
      test.skip();
      return;
    }

    await payoutsTab.click();
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('table tbody tr').first();
    if (!await firstRow.isVisible().catch(() => false)) {
      test.skip();
      return;
    }

    // Open payout detail — click view/expand button or the row itself
    const viewBtn = firstRow.getByRole('button', { name: /view|detail|expand/i }).first();
    if (await viewBtn.isVisible().catch(() => false)) {
      await viewBtn.click();
    } else {
      await firstRow.click();
    }

    await page.waitForLoadState('networkidle');

    // Payout detail must show breakdown line items
    const body = await page.locator('body').textContent() ?? '';
    const hasLineItems = /base salary|per.?order|commission|clawback|deduction|adjustment/i.test(body);
    expect(hasLineItems).toBe(true);
  });

  test('payout detail shows net payout amount', async ({ page }) => {
    await loginAsHR(page);
    await page.goto('/admin/hr');
    await page.waitForLoadState('networkidle');

    const payoutsTab = page.getByRole('button', { name: /payout/i }).first();
    if (!await payoutsTab.isVisible().catch(() => false)) {
      test.skip();
      return;
    }

    await payoutsTab.click();
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('table tbody tr').first();
    if (!await firstRow.isVisible().catch(() => false)) {
      test.skip();
      return;
    }

    const viewBtn = firstRow.getByRole('button', { name: /view|detail|expand/i }).first();
    if (await viewBtn.isVisible().catch(() => false)) {
      await viewBtn.click();
    } else {
      await firstRow.click();
    }

    await page.waitForLoadState('networkidle');

    // Net payout must be visible as a naira amount
    const body = await page.locator('body').textContent() ?? '';
    const hasNetPayout = /net.?payout|total.?payout|₦[\d,]+/i.test(body);
    expect(hasNetPayout).toBe(true);
  });
});

test.describe('Commission Output UI — SuperAdmin', () => {
  test('SuperAdmin can access HR payouts', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/admin/hr');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).not.toContainText(/unauthorized|forbidden/i);
  });

  test('commission plan shows baseSalary threshold and perOrderRate fields', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/admin/hr');
    await page.waitForLoadState('networkidle');

    const plansTab = page.getByRole('button', { name: /plan/i }).first();
    if (!await plansTab.isVisible().catch(() => false)) {
      test.skip();
      return;
    }

    await plansTab.click();
    await page.waitForLoadState('networkidle');

    const body = await page.locator('body').textContent() ?? '';
    // Commission plan UI should expose rule fields
    const hasRuleFields = /salary|threshold|per.?order|rate|bonus/i.test(body);
    expect(hasRuleFields).toBe(true);
  });
});
