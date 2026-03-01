import { redirect } from '@remix-run/node';

/**
 * Root index — redirects to admin dashboard.
 * In production, this will check session and redirect to /auth/login if not authenticated.
 */
export function loader() {
  return redirect('/admin');
}

export default function Index() {
  return null;
}
