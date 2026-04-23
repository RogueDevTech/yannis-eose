import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getCurrentUser, safeStatus } from '~/lib/api.server';
import { AuthPage } from '~/features/auth/AuthPage';

const ALLOWED_REDIRECT_PREFIXES = ['/admin', '/tpl', '/rider'] as const;

function isAllowedRedirectPath(path: string): boolean {
  try {
    const decoded = decodeURIComponent(path);
    return ALLOWED_REDIRECT_PREFIXES.some((prefix) => decoded.startsWith(prefix));
  } catch {
    return false;
  }
}

export const meta: MetaFunction = () => {
  return [
    { title: 'Yannis EOSE — Login' },
    { name: 'description', content: 'Sign in to Yannis EOSE' },
  ];
};

/**
 * Loader — if already authenticated, redirect by role or to redirectTo if valid.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const user = await getCurrentUser(request);
    if (user) {
      const url = new URL(request.url);
      const redirectTo = url.searchParams.get('redirectTo');
      if (redirectTo && isAllowedRedirectPath(redirectTo)) {
        return redirect(decodeURIComponent(redirectTo));
      }
      if (user.role === 'TPL_MANAGER') return redirect('/tpl');
      if (user.role === 'TPL_RIDER') return redirect('/rider');
      return redirect('/admin');
    }
  } catch {
    // API unreachable — continue to show login/setup
  }

  // Check if setup is needed (graceful fallback if API is unreachable)
  let needsSetup = false;
  try {
    const setupRes = await apiRequest<{ setupComplete?: boolean }>('/auth/setup-status');
    needsSetup = setupRes.ok ? !setupRes.data.setupComplete : false;
  } catch {
    // API unreachable — show login form
  }

  return { needsSetup };
}

/**
 * Action — handle login or setup form submission.
 */
export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString() ?? 'login';

  if (intent === 'setup') {
    return handleSetup(request, formData);
  }

  return handleLogin(request, formData);
}

async function handleLogin(request: Request, formData: FormData) {
  const email = formData.get('email')?.toString() ?? '';
  const password = formData.get('password')?.toString() ?? '';

  if (!email || !password) {
    return json({ error: 'Email and password are required' }, { status: 400 });
  }

  let res: Awaited<ReturnType<typeof apiRequest<{ message: string; user?: { id: string; name: string; role: string; email: string } }>>>;
  try {
    res = await apiRequest<{
      message: string;
      user?: { id: string; name: string; role: string; email: string };
    }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      timeoutMs: 20_000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Request failed';
    if (message === 'API_REQUEST_TIMEOUT') {
      return json({ error: 'Request timed out. Please try again.' }, { status: 504 });
    }
    if (message === 'API_UNREACHABLE') {
      return json({ error: 'Unable to reach the server. Please check your connection and try again.' }, { status: 503 });
    }
    throw err;
  }

  if (!res.ok) {
    const errorData = res.data as { message?: string };
    return json({ error: errorData.message ?? 'Invalid credentials' }, { status: safeStatus(res.status) });
  }

  const headers = new Headers();
  for (const c of res.setCookies) {
    headers.append('Set-Cookie', c);
  }

  const url = new URL(request.url);
  const redirectTo = url.searchParams.get('redirectTo');
  let target: string;
  if (redirectTo && isAllowedRedirectPath(redirectTo)) {
    target = decodeURIComponent(redirectTo);
  } else {
    const role = res.data?.user?.role;
    target = role === 'TPL_MANAGER' ? '/tpl' : role === 'TPL_RIDER' ? '/rider' : '/admin';
  }
  return redirect(target, { headers });
}

async function handleSetup(request: Request, formData: FormData) {
  const name = formData.get('name')?.toString() ?? '';
  const email = formData.get('email')?.toString() ?? '';
  const password = formData.get('password')?.toString() ?? '';
  const confirmPassword = formData.get('confirmPassword')?.toString() ?? '';

  if (!name || !email || !password) {
    return json({ error: 'All fields are required' }, { status: 400 });
  }

  if (password.length < 8) {
    return json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  if (password !== confirmPassword) {
    return json({ error: 'Passwords do not match' }, { status: 400 });
  }

  const res = await apiRequest<{ message: string }>('/auth/setup', {
    method: 'POST',
    body: { name, email, password },
  });

  if (!res.ok) {
    const errorData = res.data as { message?: string };
    return json({ error: errorData.message ?? 'Setup failed' }, { status: safeStatus(res.status) });
  }

  // Auto-login after setup
  const loginRes = await apiRequest<{ message: string }>('/auth/login', {
    method: 'POST',
    body: { email, password },
  });

  if (loginRes.ok && loginRes.setCookies.length > 0) {
    const headers = new Headers();
    for (const c of loginRes.setCookies) {
      headers.append('Set-Cookie', c);
    }
    const url = new URL(request.url);
    const redirectTo = url.searchParams.get('redirectTo');
    const target = redirectTo && isAllowedRedirectPath(redirectTo) ? decodeURIComponent(redirectTo) : '/admin';
    return redirect(target, { headers });
  }

  // If auto-login fails, just redirect to login page
  return json({ success: 'SuperAdmin created! You can now log in.' });
}

export default function AuthRoute() {
  const { needsSetup } = useLoaderData<typeof loader>();

  return <AuthPage needsSetup={needsSetup} />;
}
