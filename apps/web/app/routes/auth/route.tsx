import { useEffect } from 'react';
import { Outlet } from '@remix-run/react';
import { applyAppTheme, readStoredThemeId } from '~/lib/theme';
import { clearLoaderCache } from '~/lib/loader-cache';

function restoreTheme() {
  try {
    applyAppTheme(readStoredThemeId());
  } catch {
    applyAppTheme('system');
  }
}

/**
 * Auth layout route — wraps /auth and /auth/logout.
 * Forces Light theme on auth pages; restores stored theme on leave.
 *
 * Also wipes the per-tab loader cache: any path through `/auth` means the
 * session is being severed (logout) or replaced (sign in as different user).
 * Clearing here prevents user A's cached order list from leaking into user
 * B's first paint when they share the same browser.
 */
export default function AuthLayout() {
  useEffect(() => {
    applyAppTheme('light');
    clearLoaderCache();
    return restoreTheme;
  }, []);

  return <Outlet />;
}
