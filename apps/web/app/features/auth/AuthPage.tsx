import { useEffect, useRef, useState } from 'react';
import { Form, Link, useActionData, useNavigation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import type { AuthActionData, AuthPageProps } from './types';

/**
 * Shared mobile-only input class — dark inputs for the surface-900 mobile background.
 * Desktop inputs use the default .input styles (white bg, dark text).
 */
const mobileInput =
  'max-lg:!bg-surface-800 max-lg:!border-surface-700 max-lg:!text-surface-100 max-lg:!placeholder-surface-500';

export function AuthPage({ needsSetup }: AuthPageProps) {
  const actionData = useActionData<AuthActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

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

      {/* Right panel — form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-6 sm:p-8 bg-surface-900 lg:bg-white lg:dark:bg-surface-950">
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

          {needsSetup ? (
            <SetupForm isSubmitting={isSubmitting} actionData={actionData} />
          ) : (
            <LoginForm isSubmitting={isSubmitting} actionData={actionData} />
          )}
        </div>
      </div>
    </div>
  );
}

function LoginForm({
  isSubmitting,
  actionData,
}: {
  isSubmitting: boolean;
  actionData?: AuthActionData;
}) {
  const [hideError, setHideError] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const nav = useNavigation();
  const prevNavState = useRef(nav.state);

  useEffect(() => {
    if (prevNavState.current === 'submitting' && nav.state === 'idle') {
      setHideError(false);
    }
    prevNavState.current = nav.state;
  }, [nav.state]);

  const onInputChange = () => setHideError(true);

  return (
    <>
      <div>
        <h2 className="text-2xl font-bold text-white lg:text-surface-900 lg:dark:text-white">
          Sign in to your account
        </h2>
        <p className="mt-2 text-sm text-surface-400 lg:text-surface-500 lg:dark:text-surface-200">
          Enter your credentials to access the dashboard
        </p>
      </div>

      {actionData?.error && !hideError && (
        <div className="rounded-lg bg-danger-700/20 lg:bg-danger-50 lg:dark:bg-danger-700/20 border border-danger-700/50 lg:border-danger-200 lg:dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-400 lg:text-danger-700 lg:dark:text-danger-500">{actionData.error}</p>
        </div>
      )}

      {actionData?.success && (
        <div className="rounded-lg bg-success-700/20 lg:bg-success-50 lg:dark:bg-success-700/20 border border-success-700/50 lg:border-success-200 lg:dark:border-success-700/50 px-4 py-3">
          <p className="text-sm text-success-400 lg:text-success-700 lg:dark:text-success-500">{actionData.success}</p>
        </div>
      )}

      <Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="login" />

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-surface-300 lg:text-surface-700 lg:dark:text-surface-300 mb-1.5"
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
            onChange={onInputChange}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-surface-300 lg:text-surface-700 lg:dark:text-surface-300"
            >
              Password
            </label>
            <Link
              to="/auth/forgot-password"
              className="text-xs text-brand-400 hover:text-brand-300 lg:text-brand-500 lg:hover:text-brand-600"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              className={`input pr-10 ${mobileInput}`}
              placeholder="Enter your password"
              onChange={onInputChange}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-300 lg:hover:text-surface-600 lg:dark:hover:text-surface-300"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                  />
                </svg>
              ) : (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>

        <Button type="submit" variant="primary" className="w-full" loading={isSubmitting} loadingText="Signing in...">
          Sign in
        </Button>
      </Form>
    </>
  );
}

function SetupForm({
  isSubmitting,
  actionData,
}: {
  isSubmitting: boolean;
  actionData?: AuthActionData;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [hideError, setHideError] = useState(false);
  const nav = useNavigation();
  const prevNavState = useRef(nav.state);

  useEffect(() => {
    if (prevNavState.current === 'submitting' && nav.state === 'idle') {
      setHideError(false);
    }
    prevNavState.current = nav.state;
  }, [nav.state]);

  const onInputChange = () => setHideError(true);

  return (
    <>
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-800/30 text-brand-300 lg:bg-brand-100 lg:text-brand-800 lg:dark:bg-brand-800/30 lg:dark:text-brand-300">
            First Time Setup
          </span>
        </div>
        <h2 className="text-2xl font-bold text-white lg:text-surface-900 lg:dark:text-white">Create Super Admin</h2>
        <p className="mt-2 text-sm text-surface-400 lg:text-surface-500 lg:dark:text-surface-200">
          Set up the first administrator account. This can only be done once.
        </p>
      </div>

      {actionData?.error && !hideError && (
        <div className="rounded-lg bg-danger-700/20 lg:bg-danger-50 lg:dark:bg-danger-700/20 border border-danger-700/50 lg:border-danger-200 lg:dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-400 lg:text-danger-700 lg:dark:text-danger-500">{actionData.error}</p>
        </div>
      )}

      <Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="setup" />

        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-surface-300 lg:text-surface-700 lg:dark:text-surface-300 mb-1.5"
          >
            Full Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            minLength={2}
            className={`input ${mobileInput}`}
            placeholder="Your full name"
            onChange={onInputChange}
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-surface-300 lg:text-surface-700 lg:dark:text-surface-300 mb-1.5"
          >
            Email Address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className={`input ${mobileInput}`}
            placeholder="admin@company.com"
            onChange={onInputChange}
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-surface-300 lg:text-surface-700 lg:dark:text-surface-300 mb-1.5"
          >
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              required
              minLength={8}
              className={`input pr-10 ${mobileInput}`}
              placeholder="Minimum 8 characters"
              onChange={onInputChange}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-300 lg:hover:text-surface-600 lg:dark:hover:text-surface-300"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                  />
                </svg>
              ) : (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-sm font-medium text-surface-300 lg:text-surface-700 lg:dark:text-surface-300 mb-1.5"
          >
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            required
            minLength={8}
            className={`input ${mobileInput}`}
            placeholder="Re-enter your password"
            onChange={onInputChange}
          />
        </div>

        <Button type="submit" variant="primary" className="w-full" loading={isSubmitting} loadingText="Creating...">
          Create Super Admin
        </Button>
      </Form>
    </>
  );
}
