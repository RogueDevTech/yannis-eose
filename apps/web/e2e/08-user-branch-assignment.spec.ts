import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin } from './helpers';

test.describe('User creation branch assignment', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
  });

  test('shows primary branch as required on create-user form', async ({ page }) => {
    await page.goto('/hr/users/new');
    await page.waitForLoadState('networkidle');

    const primaryBranch = page.locator('select[name="primaryBranchId"]');
    await expect(primaryBranch).toBeVisible();
    await expect(primaryBranch).toHaveAttribute('required', '');
  });

  test('primary branch selector has options when branches exist', async ({ page }) => {
    await page.goto('/hr/users/new');
    await page.waitForLoadState('networkidle');

    const options = page.locator('select[name="primaryBranchId"] option');
    await expect(options.first()).toContainText(/select primary branch/i);
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(1);
  });
});
