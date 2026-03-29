import { useEffect } from 'react';
import { Outlet } from '@remix-run/react';
import { applyAppTheme, readStoredThemeId } from '~/lib/theme';

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
 */
export default function AuthLayout() {
  useEffect(() => {
    applyAppTheme('light');
    return restoreTheme;
  }, []);

  return <Outlet />;
}
