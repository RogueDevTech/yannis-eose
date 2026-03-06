import { Link } from '@remix-run/react';
import type { FundingBalanceRow } from './types';

export interface MediaBuyerBalanceCardProps {
  row: FundingBalanceRow;
  className?: string;
}

/**
 * Card used on Live Activities (Marketing) and Team page to represent a media buyer
 * with funding balance. Matches the card style used in the media buyer strip.
 */
export function MediaBuyerBalanceCard({ row, className = '' }: MediaBuyerBalanceCardProps) {
  const initials = row.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className={`card ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-brand-600 dark:text-brand-400">{initials}</span>
        </div>
        <div className="min-w-0 flex-1">
          <Link
            to={`/hr/users/${row.userId}`}
            prefetch="intent"
            className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate block hover:text-brand-600 dark:hover:text-brand-400"
          >
            {row.name}
          </Link>
          <p className="text-xs text-surface-800 dark:text-surface-200">Media Buyer</p>
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-surface-700 dark:text-surface-300">Balance</span>
          <span className="font-medium text-brand-600 dark:text-brand-400">
            ₦{Number(row.balance).toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between text-surface-500 dark:text-surface-400">
          <span>Received</span>
          <span>₦{Number(row.totalReceived).toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-surface-500 dark:text-surface-400">
          <span>Spent</span>
          <span>₦{Number(row.totalSpend).toLocaleString()}</span>
        </div>
      </div>
      <Link
        to={`/hr/users/${row.userId}`}
        prefetch="intent"
        className="mt-3 block text-center text-xs font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
      >
        View profile
      </Link>
    </div>
  );
}
