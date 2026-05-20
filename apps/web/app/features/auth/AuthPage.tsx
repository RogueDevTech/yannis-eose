import { useEffect, useRef, useState } from 'react';
import { Form, Link, useActionData, useNavigation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { TextInput } from '~/components/ui/text-input';
import { PageNotification } from '~/components/ui/page-notification';
import { EyeToggle } from './EyeToggle';
import type { AuthActionData, AuthPageProps } from './types';

/** Mobile: match elevated field chrome to app theme (same tokens as desktop). */
const mobileInput =
  'max-lg:!bg-app-elevated max-lg:!border-app-border max-lg:!text-app-fg max-lg:!placeholder-app-fg-muted';

export function AuthPage({ needsSetup, redirectTo }: AuthPageProps) {
  const actionData = useActionData<AuthActionData>();
  const navigation = useNavigation();
  // Stay in loading state through BOTH the submit phase and the post-action
  // redirect/loader phase, so the Sign in button doesn't visibly "go idle"
  // for the few hundred ms between the auth action returning and the
  // dashboard's loader resolving — that gap was confusing users into
  // thinking the click didn't take. `formData` is set during 'submitting'
  // AND stays set during the 'loading' phase that follows a form redirect.
  const isSubmitting = navigation.state !== 'idle' && navigation.formData != null;

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

      {/* Right panel — form (app theme canvas / elevated) */}
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

          {needsSetup ? (
            <SetupForm
              isSubmitting={isSubmitting}
              actionData={actionData}
              redirectTo={redirectTo}
            />
          ) : (
            <LoginForm
              isSubmitting={isSubmitting}
              actionData={actionData}
              redirectTo={redirectTo}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** localStorage key for the remembered sign-in email. Password is NEVER stored. */
const REMEMBERED_EMAIL_KEY = 'yannis-remembered-email';

function LoginForm({
  isSubmitting,
  actionData,
  redirectTo,
}: {
  isSubmitting: boolean;
  actionData?: AuthActionData;
  redirectTo: string | null;
}) {
  const [dismissedError, setDismissedError] = useState(false);
  const [dismissedSuccess, setDismissedSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const nav = useNavigation();
  const prevNavState = useRef(nav.state);

  useEffect(() => {
    if (prevNavState.current === 'submitting' && nav.state === 'idle') {
      setDismissedError(false);
      setDismissedSuccess(false);
    }
    prevNavState.current = nav.state;
  }, [nav.state]);

  useEffect(() => {
    if (actionData?.error) setDismissedError(false);
    if (actionData?.success) setDismissedSuccess(false);
  }, [actionData?.error, actionData?.success]);

  // Restore the previously-remembered email on mount. Password is never stored — the
  // user always retypes it. The checkbox stays checked so a second sign-in just refreshes
  // the saved value.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const remembered = window.localStorage.getItem(REMEMBERED_EMAIL_KEY);
    if (remembered) {
      setEmail(remembered);
      setRememberMe(true);
    }
  }, []);

  // Persist (or clear) the remembered email when the user submits.
  // On checked + non-empty email → save. On unchecked → wipe any prior value.
  const persistRememberedEmail = () => {
    if (typeof window === 'undefined') return;
    if (rememberMe && email.trim()) {
      window.localStorage.setItem(REMEMBERED_EMAIL_KEY, email.trim());
    } else {
      window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
    }
  };

  return (
    <>
      <div>
        <h2 className="text-2xl font-bold text-app-fg">
          Sign in to your account
        </h2>
        <p className="mt-2 text-sm text-app-fg-muted">
          Enter your credentials to access the dashboard
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

      {actionData?.success && !dismissedSuccess && (
        <PageNotification
          variant="success"
          message={actionData.success}
          durationMs={5000}
          onDismiss={() => setDismissedSuccess(true)}
        />
      )}

      <Form method="post" className="space-y-4" onSubmit={persistRememberedEmail}>
        <input type="hidden" name="intent" value="login" />
        {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}

        <TextInput
          id="email"
          name="email"
          type="email"
          label="Email address"
          autoComplete="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={mobileInput}
        />

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="password" className="text-xs font-medium text-app-fg-muted">
              Password
            </label>
            <Link
              to="/auth/forgot-password"
              className="text-xs text-brand-400 hover:text-brand-300 lg:text-brand-500 lg:hover:text-brand-600"
            >
              Forgot password?
            </Link>
          </div>
          <TextInput
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            placeholder="Enter your password"
            className={mobileInput}
            rightAction={<EyeToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />}
          />
        </div>

        <label
          htmlFor="rememberMe"
          className="flex items-center gap-2 cursor-pointer select-none text-sm text-app-fg-muted"
        >
          <Checkbox
            id="rememberMe"
            name="rememberMe"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          <span>Remember me on this device</span>
        </label>

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
  redirectTo,
}: {
  isSubmitting: boolean;
  actionData?: AuthActionData;
  redirectTo: string | null;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [dismissedError, setDismissedError] = useState(false);
  const nav = useNavigation();
  const prevNavState = useRef(nav.state);

  useEffect(() => {
    if (prevNavState.current === 'submitting' && nav.state === 'idle') {
      setDismissedError(false);
    }
    prevNavState.current = nav.state;
  }, [nav.state]);

  useEffect(() => {
    if (actionData?.error) setDismissedError(false);
  }, [actionData?.error]);

  const onInputChange = () => {};

  return (
    <>
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-800/30 text-brand-300 lg:bg-brand-100 lg:text-brand-800">
            First Time Setup
          </span>
        </div>
        <h2 className="text-2xl font-bold text-app-fg">Create Super Admin</h2>
        <p className="mt-2 text-sm text-app-fg-muted">
          Set up the first administrator account. This can only be done once.
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
        <input type="hidden" name="intent" value="setup" />
        {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}

        <TextInput
          id="name"
          name="name"
          type="text"
          label="Full Name"
          required
          minLength={2}
          placeholder="Your full name"
          onChange={onInputChange}
          className={mobileInput}
        />

        <TextInput
          id="email"
          name="email"
          type="email"
          label="Email Address"
          autoComplete="email"
          required
          placeholder="admin@company.com"
          onChange={onInputChange}
          className={mobileInput}
        />

        <TextInput
          id="password"
          name="password"
          type={showPassword ? 'text' : 'password'}
          label="Password"
          required
          minLength={8}
          placeholder="Minimum 8 characters"
          onChange={onInputChange}
          className={mobileInput}
          rightAction={<EyeToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />}
        />

        <TextInput
          id="confirmPassword"
          name="confirmPassword"
          type={showPassword ? 'text' : 'password'}
          label="Confirm Password"
          required
          minLength={8}
          placeholder="Re-enter your password"
          onChange={onInputChange}
          className={mobileInput}
        />

        <Button type="submit" variant="primary" className="w-full" loading={isSubmitting} loadingText="Creating...">
          Create Super Admin
        </Button>
      </Form>
    </>
  );
}
