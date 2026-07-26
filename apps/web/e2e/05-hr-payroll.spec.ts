import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin, loginAsHR, navigateTo } from './helpers';

/**
 * E2E Test: HR Payroll — monthly batches, config, payslips
 */

test.describe('HR Payroll — SuperAdmin', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
  });

  test('payroll page loads monthly batches', async ({ page }) => {
    await page.goto('/hr/payroll');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).toContainText(/payroll|monthly/i);
  });

  test('payroll config roles page loads', async ({ page }) => {
    await page.goto('/hr/payroll/config/roles');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).toContainText(/role|payroll/i);
  });

  test('payslips page loads', async ({ page }) => {
    await page.goto('/hr/payroll/payslips');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).toContainText(/payslip/i);
  });
});

test.describe('HR Payroll — HR Manager', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsHR(page);
  });

  test('HR manager can open payroll reports', async ({ page }) => {
    await page.goto('/hr/payroll/reports');
    await expect(page.locator('body')).not.toContainText(/something went wrong/i);
    await expect(page.locator('body')).toContainText(/register|report|payroll/i);
  });
});
