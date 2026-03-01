import { Form } from '@remix-run/react';
import type { MetaFunction } from '@remix-run/node';

export const meta: MetaFunction = () => {
  return [
    { title: 'Yannis EOSE — Login' },
    { name: 'description', content: 'Sign in to Yannis EOSE' },
  ];
};

export default function Login() {
  return (
    <div className="flex min-h-screen">
      {/* Left panel — brand */}
      <div className="hidden lg:flex lg:w-1/2 bg-surface-900 items-center justify-center p-12">
        <div className="text-center">
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-xl bg-brand-500 flex items-center justify-center">
              <div className="w-4 h-4 rounded-full bg-white" />
            </div>
            <span className="text-4xl font-bold text-white tracking-tight">
              YANNIS
            </span>
          </div>
          <p className="text-surface-400 text-lg">
            Enterprise Operations & Sales Engine
          </p>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-6 sm:p-8 bg-white dark:bg-surface-950">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden text-center">
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-brand-500 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-white" />
              </div>
              <span className="text-2xl font-bold text-surface-900 dark:text-white tracking-tight">
                YANNIS
              </span>
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-surface-900 dark:text-white">
              Sign in to your account
            </h2>
            <p className="mt-2 text-sm text-surface-500 dark:text-surface-400">
              Enter your credentials to access the dashboard
            </p>
          </div>

          <Form method="post" className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5"
              >
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="input"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="input"
                placeholder="Enter your password"
              />
            </div>

            <button type="submit" className="btn-primary w-full">
              Sign in
            </button>
          </Form>
        </div>
      </div>
    </div>
  );
}
