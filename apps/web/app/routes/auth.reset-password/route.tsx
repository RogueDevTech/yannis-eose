import { useEffect, useRef, useState } from 'react';
import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Form, Link, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { PageNotification } from '~/components/ui/page-notification';
import { EyeToggle } from '~/features/auth/EyeToggle';
import { apiRequest, getCurrentUser, safeStatus } from '~/lib/api.server';

export const meta: MetaFunction = () => {
  return [
    { title: 'Yannis EOSE — Reset Password' },
    { name: 'description', content: 'Set a new password for your Yannis EOSE account' },
  ];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request, { softNetwork: true });
  if (user) return redirect('/admin');

  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';

  return { token };
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const token = formData.get('token')?.toString() ?? '';
  const newPassword = formData.get('newPassword')?.toString() ?? '';
  const confirmPassword = formData.get('confirmPassword')?.toString() ?? '';

  if (!token) {
    return json({ error: 'Invalid reset link. Please request a new one.' }, { status: 400 });
  }

  if (!newPassword) {
    return json({ error: 'Please enter a new password.' }, { status: 400 });
  }

  if (newPassword.length < 8) {
    return json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  if (newPassword !== confirmPassword) {
    return json({ error: 'Passwords do not match.' }, { status: 400 });
  }

  const res = await apiRequest<{ message?: string; error?: string }>('/auth/reset-password', {
    method: 'POST',
    body: { token, newPassword },
  });

  if (!res.ok) {
    const msg = (res.data as { message?: string }).message ?? 'Failed to reset password. The link may have expired.';
    return json({ error: msg }, { status: safeStatus(res.status) });
  }

  return json({ success: res.data.message ?? 'Password has been reset successfully.' });
}

const mobileInput =
  'max-lg:!bg-app-elevated max-lg:!border-app-border max-lg:!text-app-fg max-lg:!placeholder-app-fg-muted';

export default function ResetPasswordRoute() {
  const { token } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ error?: string; success?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const [showPassword, setShowPassword] = useState(false);
  const [dismissedError, setDismissedError] = useState(false);
  const prevNavState = useRef(navigation.state);

  useEffect(() => {
    if (prevNavState.current === 'submitting' && navigation.state === 'idle') {
      setDismissedError(false);
    }
    prevNavState.current = navigation.state;
  }, [navigation.state]);

  useEffect(() => {
    if (actionData?.error) setDismissedError(false);
  }, [actionData?.error]);

  const onInputChange = () => {};

  const hasToken = Boolean(token);

  return (
    <div className="flex min-h-screen">
      {/* Left panel — brand (desktop only) */}
      <div className="hidden lg:flex lg:w-1/2 bg-surface-900 items-center justify-center p-12">
        <div className="text-center">
          <div className="flex items-center justify-center mb-6">
            <img
              src="/assets/yannis-logo1.png"
              alt="Yannis"
              className="h-14 w-auto max-w-full object-contain"
            />
          </div>
          <p className="text-slate-400 text-lg">Enterprise Operations & Sales Engine</p>
        </div>
      </div>

      {/* Right panel — form (app theme) */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-6 sm:p-8 bg-app-canvas lg:bg-app-elevated">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden text-center">
            <div className="flex items-center justify-center mb-2">
              <img
                src="/assets/yannis-logo1.png"
                alt="Yannis"
                className="h-10 w-auto max-w-full object-contain"
              />
            </div>
            <p className="text-app-fg-muted text-sm">Enterprise Operations & Sales Engine</p>
          </div>

          {actionData?.success ? (
            <>
              <div>
                <h2 className="text-2xl font-bold text-app-fg">
                  Password reset
                </h2>
                <p className="mt-2 text-sm text-app-fg-muted">
                  {actionData.success} You can now sign in with your new password.
                </p>
              </div>

              <Link
                to="/auth"
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                Sign in
              </Link>
            </>
          ) : !hasToken ? (
            <>
              <div>
                <h2 className="text-2xl font-bold text-app-fg">
                  Invalid reset link
                </h2>
                <p className="mt-2 text-sm text-app-fg-muted">
                  This password reset link is invalid or has expired. Please request a new one.
                </p>
              </div>

              <Link
                to="/auth/forgot-password"
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                Request new reset link
              </Link>

              <div className="text-center">
                <Link
                  to="/auth"
                  className="text-sm text-brand-400 hover:text-brand-300 lg:text-brand-500 lg:hover:text-brand-600"
                >
                  Back to sign in
                </Link>
              </div>
            </>
          ) : (
            <>
              <div>
                <h2 className="text-2xl font-bold text-app-fg">
                  Set new password
                </h2>
                <p className="mt-2 text-sm text-app-fg-muted">
                  Enter your new password below. Must be at least 8 characters.
                </p>
              </div>

              {actionData?.error && !dismissedError && (
                <PageNotification
                  variant="error"
                  message={actionData.error}
                  durationMs={5000}
                  onDismiss={() => setDismissedError(true)}
                />
              )}

              <Form method="post" className="space-y-4">
                <input type="hidden" name="token" value={token} />

                <TextInput
                  id="newPassword"
                  name="newPassword"
                  type={showPassword ? 'text' : 'password'}
                  label="New password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="Minimum 8 characters"
                  autoFocus
                  onChange={onInputChange}
                  className={mobileInput}
                  rightAction={<EyeToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />}
                />

                <TextInput
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  label="Confirm new password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="Re-enter your password"
                  onChange={onInputChange}
                  className={mobileInput}
                />

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full flex items-center justify-center gap-2"
                  loading={isSubmitting}
                  loadingText="Resetting..."
                >
                  Reset password
                </Button>

                <div className="text-center">
                  <Link
                    to="/auth"
                    className="text-sm text-brand-400 hover:text-brand-300 lg:text-brand-500 lg:hover:text-brand-600"
                  >
                    Back to sign in
                  </Link>
                </div>
              </Form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
