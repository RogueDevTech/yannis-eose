import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin } from './helpers';

test.describe('HR create user — permission baseline from role', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
  });

  test('selecting a role shows permission matrix with inherited count from template', async ({ page }) => {
    await page.goto('/hr/users/new');
    await page.waitForLoadState('networkidle');

    await page.locator('select[name="role"]').selectOption('CS_AGENT');

    await expect(page.getByRole('heading', { name: 'Permissions' })).toBeVisible();
    await expect(page.getByText(/^Inherited: [1-9]\d*$/)).toBeVisible();
  });
});
