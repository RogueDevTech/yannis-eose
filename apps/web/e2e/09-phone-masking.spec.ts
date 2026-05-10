import { test, expect } from '@playwright/test';
import {
  loginAsSuperAdmin,
  loginAsCsAgent,
  loginAsMediaBuyer,
  loginAsFinance,
  loginAsHR,
  loginAsRider,
  loginAsHoM,
  assertNoExposedPhoneNumbers,
} from './helpers';

/**
 * E2E Test: Phone Number Masking — Pillar 2 (Lead Fortress)
 *
 * Verifies that raw phone numbers (Nigerian patterns 0XXXXXXXXXX or +234XXXXXXXXXX)
 * are NEVER exposed in the UI or network responses for any role.
 *
 * Masked format 0803****1234 is allowed.
 */

const PHONE_SENSITIVE_PAGES = [
  '/admin/cs/orders',
  '/admin/cs/queue',
];

async function assertNetworkResponsesClean(page: import('@playwright/test').Page): Promise<void> {
  const exposedPhones: string[] = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/trpc/') || url.includes('/api/')) {
      try {
        const body = await response.text();
        const phoneMatches = body.match(/0[789]\d{9}|\+234\d{10}/g);
        if (phoneMatches) {
          const realPhones = phoneMatches.filter((p) => !p.includes('****') && p.length <= 14);
          exposedPhones.push(...realPhones);
        }
      } catch {
        // Response already consumed or non-text — skip
      }
    }
  });

  return new Promise((resolve) => {
    // Check after page settles
    setTimeout(() => {
      expect(exposedPhones, `Exposed phone numbers in network responses: ${exposedPhones.join(', ')}`).toHaveLength(0);
      resolve();
    }, 500);
  });
}

test.describe('Phone Masking — SuperAdmin', () => {
  test('no raw phone numbers in CS orders UI', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/admin/cs/orders');
    await page.waitForLoadState('networkidle');
    await assertNoExposedPhoneNumbers(page);
  });

  test('no raw phone numbers in CS queue UI', async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto('/admin/cs/queue');
    await page.waitForLoadState('networkidle');
    await assertNoExposedPhoneNumbers(page);
  });

  test('no raw phone numbers in network responses', async ({ page }) => {
    const exposedPhones: string[] = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/trpc/') || url.includes('/api/')) {
        try {
          const body = await response.text();
          const matches = body.match(/0[789]\d{9}|\+234\d{10}/g);
          if (matches) {
            const real = matches.filter((p) => !p.includes('****') && p.length <= 14);
            exposedPhones.push(...real);
          }
        } catch { /* skip */ }
      }
    });

    await loginAsSuperAdmin(page);
    await page.goto('/admin/cs/orders');
    await page.waitForLoadState('networkidle');
    expect(exposedPhones).toHaveLength(0);
  });
});

test.describe('Phone Masking — CS Closer', () => {
  test('no raw phone numbers in assigned orders UI', async ({ page }) => {
    await loginAsCsAgent(page);
    await page.goto('/admin/cs/queue');
    await page.waitForLoadState('networkidle');
    await assertNoExposedPhoneNumbers(page);
  });
});

test.describe('Phone Masking — Media Buyer', () => {
  test('no raw phone numbers in marketing orders UI', async ({ page }) => {
    await loginAsMediaBuyer(page);
    await page.goto('/admin/marketing/orders');
    await page.waitForLoadState('networkidle');
    await assertNoExposedPhoneNumbers(page);
  });
});

test.describe('Phone Masking — Finance Officer', () => {
  test('no raw phone numbers in orders UI for finance role', async ({ page }) => {
    await loginAsFinance(page);
    await page.goto('/admin/cs/orders');
    await page.waitForLoadState('networkidle');
    await assertNoExposedPhoneNumbers(page);
  });
});

test.describe('Phone Masking — Head of Marketing', () => {
  test('no raw phone numbers in marketing overview', async ({ page }) => {
    await loginAsHoM(page);
    await page.goto('/admin/marketing/overview');
    await page.waitForLoadState('networkidle');
    await assertNoExposedPhoneNumbers(page);
  });
});
