import { type Page, expect } from '@playwright/test';

/**
 * Test helper utilities for Yannis EOSE E2E tests.
 */

const API_URL = process.env.API_URL ?? 'http://localhost:4444';

/** Login as a user with specific credentials. */
export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/auth');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  // Wait for redirect to admin dashboard
  await page.waitForURL(/\/admin/, { timeout: 10000 });
}

/** Login as SuperAdmin. */
export async function loginAsSuperAdmin(page: Page): Promise<void> {
  await login(page, 'admin@yannis.test', 'Test@12345');
}

/** Login as CS Closer. */
export async function loginAsCsAgent(page: Page): Promise<void> {
  await login(page, 'cs.agent@yannis.test', 'Test@12345');
}

/** Login as Media Buyer. */
export async function loginAsMediaBuyer(page: Page): Promise<void> {
  await login(page, 'media.buyer@yannis.test', 'Test@12345');
}

/** Login as Finance Officer. */
export async function loginAsFinance(page: Page): Promise<void> {
  await login(page, 'finance@yannis.test', 'Test@12345');
}

/** Login as HR Manager. */
export async function loginAsHR(page: Page): Promise<void> {
  await login(page, 'hr@yannis.test', 'Test@12345');
}

/** Login as 3PL Rider. */
export async function loginAsRider(page: Page): Promise<void> {
  await login(page, 'rider@yannis.test', 'Test@12345');
}

/** Login as Head of Marketing. */
export async function loginAsHoM(page: Page): Promise<void> {
  await login(page, 'hom@yannis.test', 'Test@12345');
}

/** Navigate to a specific admin section. */
export async function navigateTo(page: Page, section: string): Promise<void> {
  await page.goto(`/admin/${section}`);
  await page.waitForLoadState('networkidle');
}

/** Create a test order directly via API. */
export async function createTestOrder(cookie: string, data?: Partial<{
  customerName: string;
  customerPhoneHash: string;
  items: Array<{ productId: string; quantity: number; unitPrice: string }>;
}>): Promise<string> {
  const orderData = {
    customerName: data?.customerName ?? 'Test Customer',
    customerPhoneHash: data?.customerPhoneHash ?? 'testhash123',
    items: data?.items ?? [{ productId: 'test-product-id', quantity: 1, unitPrice: '5000' }],
  };

  const response = await fetch(`${API_URL}/trpc/orders.create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(orderData),
  });

  const result = await response.json();
  return result?.result?.data?.id ?? '';
}

/** Wait for a toast/notification to appear. */
export async function waitForToast(page: Page, textPattern: RegExp): Promise<void> {
  await expect(page.getByText(textPattern).first()).toBeVisible({ timeout: 5000 });
}

/** Check that a page element does NOT contain sensitive phone data. */
export async function assertNoExposedPhoneNumbers(page: Page): Promise<void> {
  const pageText = await page.textContent('body');
  // Nigerian phone number patterns
  const phonePatterns = [
    /0[789]\d{9}/,
    /\+234\d{10}/,
    /234\d{10}/,
  ];
  for (const pattern of phonePatterns) {
    // Allow masked phones (0803****1234) but not full numbers
    const unmasked = pageText?.match(pattern);
    if (unmasked) {
      // Check if it's masked (contains ****)
      const full = unmasked[0];
      if (!full.includes('****')) {
        throw new Error(`Exposed phone number found in page: ${full}`);
      }
    }
  }
}

/** Get the count of elements matching a test-id pattern. */
export async function countElements(page: Page, selector: string): Promise<number> {
  return page.locator(selector).count();
}
