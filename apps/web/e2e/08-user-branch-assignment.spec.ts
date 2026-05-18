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

  test('orders API stays scoped to selected branch', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    const branchesRes = await page.request.get('/trpc/branches.list?input=%7B%7D');
    expect(branchesRes.ok()).toBeTruthy();
    const branchesJson = await branchesRes.json();
    const branches = (branchesJson?.result?.data ?? []) as Array<{ id: string }>;

    test.skip(branches.length < 2, 'Need at least two branches for isolation check');

    const selectedBranch = branches[0]!.id;
    const switchRes = await page.request.post('/admin/branches/switch', {
      form: { intent: 'switchBranch', branchId: selectedBranch },
    });
    expect(switchRes.ok()).toBeTruthy();

    const listInput = encodeURIComponent(JSON.stringify({ page: 1, limit: 50 }));
    const ordersRes = await page.request.get(`/trpc/orders.list?input=${listInput}`);
    expect(ordersRes.ok()).toBeTruthy();
    const ordersJson = await ordersRes.json();
    const data = ordersJson?.result?.data;
    const orders = (Array.isArray(data) ? data : data?.orders ?? data?.records ?? []) as Array<{ branchId?: string | null }>;

    for (const order of orders) {
      expect(order.branchId ?? null).toBe(selectedBranch);
    }
  });
});
