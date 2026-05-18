import { forwardRef } from 'react';

type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

// Custom-rendered checkbox. We disable native appearance and paint our own
// brand-blue fill + white tick so it looks identical across browsers (Safari /
// iOS ignore CSS `accent-color` on the box itself and only tint the tick,
// which is why earlier renders looked washed-out / purple in some themes).
const baseClasses =
  'yannis-checkbox appearance-none w-4 h-4 rounded border border-app-border bg-app-elevated cursor-pointer ' +
  'transition-colors hover:border-brand-400 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:focus-visible:ring-brand-400 ' +
  'focus:ring-offset-0 dark:focus:ring-offset-0 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

// Inline a tiny <style> block — co-located with the component, scoped via the
// `yannis-checkbox` class — so the checked-state background color + tick SVG
// land as a single rule (no Tailwind shorthand cascade fighting between
// `bg-{color}` and `bg-[url(...)]`).
const CHECKBOX_STYLE = `
.yannis-checkbox:checked {
  background-color: #1565C0;
  border-color: #1565C0;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.5 8.5l3 3 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: center;
  background-size: 100% 100%;
}
.yannis-checkbox:checked:hover {
  background-color: #0d47a1;
  border-color: #0d47a1;
}
`;

let styleInjected = false;
function ensureStyle() {
  if (typeof document === 'undefined' || styleInjected) return;
  const el = document.createElement('style');
  el.setAttribute('data-yannis', 'checkbox');
  el.textContent = CHECKBOX_STYLE;
  document.head.appendChild(el);
  styleInjected = true;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className = '', ...props }, ref) => {
    ensureStyle();
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

