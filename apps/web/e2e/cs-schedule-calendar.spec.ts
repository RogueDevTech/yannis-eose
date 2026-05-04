import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin } from './helpers';

test.describe('CS orders — schedule calendar', () => {
  test('renders heat calendar and schedule controls', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/admin/cs/orders?calendarMonth=2026-05');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Heat shows scheduled callbacks')).toBeVisible();
    await expect(page.getByLabel('Filter by callback or delivery date')).toBeVisible();
  });
});
