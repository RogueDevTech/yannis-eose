import { Link } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { AddExpenseForm } from './AddExpenseForm';
import type { Campaign, Product } from './types';

export function MarketingAddExpensePage({
  picklistsPromise,
}: {
  picklistsPromise:
    | Promise<{ campaigns: Campaign[]; products: Product[] }>
    | { campaigns: Campaign[]; products: Product[] };
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Log expenses"
        description="Daily ad spend per form — screenshot required."
        actions={
          <Link
            to="/admin/marketing/ad-spend"
            className="btn-secondary btn-sm inline-flex items-center justify-center shrink-0"
          >
            Back to Ads Expense
          </Link>
        }
      />
      <AddExpenseForm picklistsPromise={picklistsPromise} />
    </div>
  );
}
