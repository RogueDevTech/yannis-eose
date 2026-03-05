import { useEffect } from 'react';
import { Outlet } from '@remix-run/react';

/** Restore theme from localStorage (same logic as root THEME_SCRIPT) */
function restoreTheme() {
  try {
    const t = localStorage.getItem('yannis_theme');
    if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch {
    document.documentElement.classList.remove('dark');
  }
}

/**
 * Auth layout route — wraps /auth and /auth/logout.
 * Forces light mode on auth pages (no theme toggle); restores user preference on leave.
 */
export default function AuthLayout() {
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    return restoreTheme;
  }, []);

  return <Outlet />;
}
