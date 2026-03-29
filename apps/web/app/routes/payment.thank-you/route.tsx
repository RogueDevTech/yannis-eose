import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useSearchParams } from '@remix-run/react';
import { Link } from '@remix-run/react';

export const meta: MetaFunction = () => [
  { title: 'Payment successful — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  return {};
}

export default function PaymentThankYou() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');

  return (
    <div className="min-h-screen flex items-center justify-center bg-app-canvas p-4">
      <div className="max-w-md w-full text-center">
        <div className="rounded-full bg-success-100 dark:bg-success-900/30 w-16 h-16 flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-success-600 dark:text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-app-fg mb-2">Payment successful</h1>
        <p className="text-app-fg-muted mb-6">
          Thank you for your order. We have received your payment and will process your order shortly.
          {orderId && (
            <span className="block mt-2 text-sm font-mono text-app-fg-muted dark:text-app-fg-muted">
              Order reference: {orderId}
            </span>
          )}
        </p>
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
