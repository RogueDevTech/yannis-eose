import type { TimelineEvent } from '~/features/orders/types';

const EVENT_ICONS: Record<string, string> = {
  ORDER_RECEIVED: '📥',
  ORDER_AUTO_ASSIGNED: '🤖',
  ORDER_MANUALLY_ASSIGNED: '👤',
  ORDER_REASSIGNED: '🔄',
  ORDER_CLAIMED: '🙋',
  ORDER_VIEWED: '👁️',
  CALL_INITIATED: '📞',
  CALL_COMPLETED: '✅',
  CALL_NO_ANSWER: '📵',
  CALL_FAILED: '❌',
  MANUAL_CALL_LOGGED: '📋',
  SMS_SENT: '💬',
  WHATSAPP_SENT: '💬',
  ORDER_CONFIRMED: '✅',
  ORDER_CANCELLED: '🚫',
  ADDRESS_UPDATED: '📍',
  QUANTITY_UPDATED: '📦',
  CALLBACK_SCHEDULED: '⏰',
  ORDER_ALLOCATED: '🏭',
  ORDER_DISPATCHED: '🚚',
  ORDER_IN_TRANSIT: '🚚',
  ORDER_DELIVERED: '🎉',
  ORDER_PARTIALLY_DELIVERED: '📦',
  ORDER_RETURNED: '↩️',
  ORDER_RESTOCKED: '📦',
  ORDER_WRITTEN_OFF: '❌',
  SUPERVISOR_WATCHING: '👀',
  PAYMENT_RECEIVED: '💳',
};

const EVENT_COLORS: Record<string, string> = {
  ORDER_RECEIVED: 'bg-brand-100 dark:bg-brand-900/40 border-brand-200 dark:border-brand-700',
  ORDER_AUTO_ASSIGNED: 'bg-surface-100 dark:bg-surface-800 border-surface-200 dark:border-surface-700',
  ORDER_MANUALLY_ASSIGNED: 'bg-surface-100 dark:bg-surface-800 border-surface-200 dark:border-surface-700',
  ORDER_REASSIGNED: 'bg-surface-100 dark:bg-surface-800 border-surface-200 dark:border-surface-700',
  ORDER_CLAIMED: 'bg-brand-50 dark:bg-brand-900/30 border-brand-100 dark:border-brand-800',
  CALL_INITIATED: 'bg-brand-50 dark:bg-brand-900/30 border-brand-100 dark:border-brand-800',
  CALL_COMPLETED: 'bg-success-50 dark:bg-success-900/30 border-success-100 dark:border-success-800',
  CALL_NO_ANSWER: 'bg-warning-50 dark:bg-warning-900/30 border-warning-100 dark:border-warning-800',
  CALL_FAILED: 'bg-danger-50 dark:bg-danger-900/30 border-danger-100 dark:border-danger-800',
  SMS_SENT: 'bg-brand-50 dark:bg-brand-900/30 border-brand-100 dark:border-brand-800',
  WHATSAPP_SENT: 'bg-success-50 dark:bg-success-900/30 border-success-100 dark:border-success-800',
  ORDER_CONFIRMED: 'bg-success-50 dark:bg-success-900/30 border-success-100 dark:border-success-800',
  ORDER_CANCELLED: 'bg-danger-50 dark:bg-danger-900/30 border-danger-100 dark:border-danger-800',
  ORDER_DELIVERED: 'bg-success-100 dark:bg-success-900/40 border-success-200 dark:border-success-700',
  ORDER_RETURNED: 'bg-warning-50 dark:bg-warning-900/30 border-warning-100 dark:border-warning-800',
  ORDER_WRITTEN_OFF: 'bg-danger-50 dark:bg-danger-900/30 border-danger-100 dark:border-danger-800',
  SUPERVISOR_WATCHING: 'bg-surface-50 dark:bg-surface-900 border-surface-100 dark:border-surface-800',
  PAYMENT_RECEIVED: 'bg-success-50 dark:bg-success-900/30 border-success-100 dark:border-success-800',
};

function formatEventType(type: string): string {
  return type
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface OrderTimelineProps {
  events: TimelineEvent[];
}

export function OrderTimeline({ events }: OrderTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-surface-600 dark:text-surface-400">
        No timeline events yet.
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-5 top-2 bottom-2 w-px bg-surface-200 dark:bg-surface-700" />

      <ol className="space-y-3">
        {events.map((event) => {
          const icon = EVENT_ICONS[event.eventType] ?? '●';
          const colorClass =
            EVENT_COLORS[event.eventType] ??
            'bg-surface-50 dark:bg-surface-900 border-surface-100 dark:border-surface-800';

          return (
            <li key={event.id} className="relative flex gap-3 pl-2">
              {/* Dot */}
              <div
                className={`relative z-10 flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full border text-sm ${colorClass}`}
                title={formatEventType(event.eventType)}
              >
                {icon}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium text-surface-900 dark:text-surface-100 leading-tight">
                    {event.description}
                  </span>
                  {event.actorName && (
                    <span className="text-xs text-surface-500 dark:text-surface-400">
                      by {event.actorName}
                    </span>
                  )}
                </div>
                <time
                  dateTime={event.createdAt}
                  className="text-xs text-surface-500 dark:text-surface-400"
                >
                  {new Date(event.createdAt).toLocaleString('en-NG', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
