import { useEffect, useState } from 'react';
import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Form, Link, useActionData, useNavigation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { PageNotification } from '~/components/ui/page-notification';
import { apiRequest, getCurrentUser } from '~/lib/api.server';

export const meta: MetaFunction = () => {
  return [
    { title: 'Yannis EOSE — Forgot Password' },
    { name: 'description', content: 'Reset your Yannis EOSE password' },
  ];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (user) return redirect('/admin');
  return {};
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = formData.get('email')?.toString()?.trim().toLowerCase() ?? '';

  if (!email) {
    return json({ error: 'Please enter your email address.' }, { status: 400 });
  }

  const url = new URL(request.url);
  const resetBaseUrl = `${url.protocol}//${url.host}/auth/reset-password`;

  const res = await apiRequest<{ message: string }>('/auth/forgot-password', {
    method: 'POST',
    body: { email, resetBaseUrl },
  });

  if (res.ok) {
    return json({ success: res.data.message });
  }

  return json({ success: 'If an account with that email exists, a reset link has been sent.' });
}

const mobileInput =
  'max-lg:!bg-surface-800 max-lg:!border-surface-700 max-lg:!text-surface-100 max-lg:!placeholder-surface-500';

export default function ForgotPasswordRoute() {
  const actionData = useActionData<{ error?: string; success?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const [dismissedError, setDismissedError] = useState(false);
  const [dismissedSuccess, setDismissedSuccess] = useState(false);

  useEffect(() => {
    if (actionData?.error) setDismissedError(false);
    if (actionData?.success) setDismissedSuccess(false);
  }, [actionData?.error, actionData?.success]);

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
          <p className="text-surface-400 text-lg">Enterprise Operations & Sales Engine</p>
        </div>
      </div>

      {/* Right panel — form (always light-mode on auth) */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-6 sm:p-8 bg-surface-900 lg:bg-white">
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
            <p className="text-surface-400 text-sm">Enterprise Operations & Sales Engine</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-white lg:text-surface-900">
              Reset your password
            </h2>
            <p className="mt-2 text-sm text-surface-400 lg:text-surface-500">
              Enter your email address and we'll send you a reset link.
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

          {actionData?.success ? (
            <>
              {!dismissedSuccess && (
                <PageNotification
                  variant="success"
                  message={actionData.success}
                  durationMs={5000}
                  onDismiss={() => setDismissedSuccess(true)}
                />
              )}

              <Link
                to="/auth"
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                Back to sign in
              </Link>
            </>
          ) : (
            <Form method="post" className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-surface-300 lg:text-surface-700 mb-1.5"
                >
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className={`input ${mobileInput}`}
                  placeholder="you@company.com"
                  autoFocus
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full flex items-center justify-center gap-2"
                loading={isSubmitting}
                loadingText="Sending..."
              >
                Send reset link
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
          )}
        </div>
      </div>
    </div>
  );
}
