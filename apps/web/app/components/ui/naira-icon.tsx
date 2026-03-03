interface NairaIconProps {
  className?: string;
  size?: number;
}

/**
 * Inline SVG of the Nigerian Naira symbol (₦).
 * Stylized N with two horizontal bars for consistent cross-browser rendering.
 */
export function NairaIcon({ className = '', size = 14 }: NairaIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M7 4v16M7 4l10 16M17 4v16" />
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="20" y2="16" />
    </svg>
  );
}
