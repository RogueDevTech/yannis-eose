interface LabelInfoProps {
  /** Explanation shown on hover/focus of the info icon. */
  text: string;
  className?: string;
}

/**
 * Small info icon that reveals an explanation on hover/focus.
 * Use next to a field label instead of a permanent helper line, so the
 * form stays clean but the guidance is one hover away.
 *
 * Visual matches the label-info pattern used by SearchableSelect so every
 * input renders identical tooltips.
 */
export function LabelInfo({ text, className = '' }: LabelInfoProps) {
  return (
    <span className={['group relative inline-flex', className].filter(Boolean).join(' ')}>
      <svg
        className="w-3.5 h-3.5 text-app-fg-muted/60 cursor-help"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
        />
      </svg>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-52 -translate-x-1/2 whitespace-normal rounded-md bg-gray-900 px-2.5 py-1.5 text-center text-[11px] font-normal normal-case leading-snug text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-gray-700"
      >
        {text}
      </span>
    </span>
  );
}
