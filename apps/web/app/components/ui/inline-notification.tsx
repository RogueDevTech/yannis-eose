import { Link } from '@remix-run/react';

type Variant = 'warning' | 'danger' | 'success' | 'info';

interface ActionItem {
  label: string;
  href: string;
}

interface InlineNotificationProps {
  variant: Variant;
  message: string;
  action?: ActionItem;
  actions?: ActionItem[];
  className?: string;
}

const variantClasses: Record<Variant, { container: string; text: string; link: string }> = {
  warning: {
    container: 'bg-warning-50 dark:bg-warning-700/20 border border-warning-200 dark:border-warning-700/50',
    text: 'text-warning-800 dark:text-warning-200',
    link: 'text-warning-700 dark:text-warning-300 hover:text-warning-800 dark:hover:text-warning-100 font-medium underline underline-offset-2',
  },
  danger: {
    container: 'bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50',
    text: 'text-danger-700 dark:text-danger-500',
    link: 'text-danger-600 dark:text-danger-400 hover:text-danger-700 dark:hover:text-danger-300 font-medium underline underline-offset-2',
  },
  success: {
    container: 'bg-success-50 dark:bg-success-700/20 border border-success-200 dark:border-success-700/50',
    text: 'text-success-700 dark:text-success-500',
    link: 'text-success-600 dark:text-success-400 hover:text-success-700 dark:hover:text-success-300 font-medium underline underline-offset-2',
  },
  info: {
    container: 'bg-info-50 dark:bg-info-700/20 border border-info-500/30 dark:border-info-700/50',
    text: 'text-info-700 dark:text-info-500',
    link: 'text-info-600 dark:text-info-500 hover:text-info-700 font-medium underline underline-offset-2',
  },
};

export function InlineNotification({
  variant,
  message,
  action,
  actions,
  className = '',
}: InlineNotificationProps) {
  const classes = variantClasses[variant];
  const items = actions ?? (action ? [action] : []);

  return (
    <div
      className={`rounded-lg px-4 py-3 ${classes.container} ${className}`}
      role="alert"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
        <p className={`text-sm ${classes.text}`}>{message}</p>
        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {items.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={`text-sm shrink-0 ${classes.link}`}
              >
                {item.label} →
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
