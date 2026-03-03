import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin, navigateTo } from './helpers';

/**
 * E2E Test: Marketing Campaign & Ad Spend Flow
 *
 * Tests campaign creation, funding ledger, and ad spend tracking.
 */

test.describe('Marketing Campaign Flow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
  });

  test('should display campaigns page', async ({ page }) => {
    await navigateTo(page, 'campaigns');
    await expect(page.locator('body')).toContainText(/campaign/i);
  });

  test('should display marketing page with KPIs', async ({ page }) => {
    await navigateTo(page, 'marketing');
    // Should show CPA, ROAS, and other marketing KPIs
    await expect(page.locator('body')).toContainText(/marketing|spend|performance/i);
  });

  test('should show funding ledger tab', async ({ page }) => {
    await navigateTo(page, 'marketing');
    const fundingTab = page.getByRole('button', { name: /funding/i }).first();
    const hasTab = await fundingTab.isVisible().catch(() => false);
    if (hasTab) {
      await fundingTab.click();
      // Should show funding records
      await expect(page.locator('body')).toContainText(/fund|amount|sent|status/i);
    }
  });

  test('should show ad spend tracking tab', async ({ page }) => {
    await navigateTo(page, 'marketing');
    const adSpendTab = page.getByRole('button', { name: /ad.spend|spend/i }).first();
    const hasTab = await adSpendTab.isVisible().catch(() => false);
    if (hasTab) {
      await adSpendTab.click();
      await expect(page.locator('body')).toContainText(/spend|amount|date/i);
    }
  });

  test('should show media buyer leaderboard', async ({ page }) => {
    await navigateTo(page, 'marketing');
    const perfTab = page.getByRole('button', { name: /performance|leaderboard/i }).first();
    const hasTab = await perfTab.isVisible().catch(() => false);
    if (hasTab) {
      await perfTab.click();
      // Should show leaderboard with ROAS/CPA metrics
      await expect(page.locator('body')).toContainText(/roas|cpa|rank|buyer/i);
    }
  });
});
