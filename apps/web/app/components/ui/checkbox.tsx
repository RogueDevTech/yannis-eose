import { forwardRef } from 'react';

type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

const baseClasses =
  'w-4 h-4 rounded border border-surface-300 bg-white cursor-pointer ' +
  'dark:border-surface-600 dark:bg-surface-800 dark:[color-scheme:dark] ' +
  'text-brand-500 accent-brand-500 dark:accent-brand-400 ' +
  'focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-400 ' +
  'focus:ring-offset-0 dark:focus:ring-offset-0';

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className = '', ...props }, ref) => {
    const classes = [baseClasses, className].filter(Boolean).join(' ');

    return (
      <input
        ref={ref}
        type="checkbox"
        className={classes}
        {...props}
      />
    );
  },
);

Checkbox.displayName = 'Checkbox';

