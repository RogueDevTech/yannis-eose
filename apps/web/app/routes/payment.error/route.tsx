import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useSearchParams, Link } from '@remix-run/react';

export const meta: MetaFunction = () => [
  { title: 'Payment issue — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  return {};
}

export default function PaymentError() {
  const [searchParams] = useSearchParams();
  const reason = searchParams.get('reason') || 'verification_failed';

  const message =
    reason === 'missing_reference'
      ? 'We could not confirm your payment. The payment reference was missing.'
      : 'We could not confirm your payment. Please contact support if you were charged.';

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950 p-4">
      <div className="max-w-md w-full text-center">
        <div className="rounded-full bg-danger-100 dark:bg-danger-900/30 w-16 h-16 flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white mb-2">Payment could not be confirmed</h1>
        <p className="text-surface-600 dark:text-surface-400 mb-6">{message}</p>
        <Link
          to="/"
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-surface-900"
        >
          Return home
        </Link>
      </div>
    </div>
  );
}
