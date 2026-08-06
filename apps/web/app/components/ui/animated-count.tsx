import { useEffect, useRef, useState } from 'react';

/**
 * AnimatedCount — a number that "rolls" when it changes and flashes green on an
 * increase. Used on the live Analytics page so a landing going 5 → 6 reads as a
 * count-up: the old digit slides up and out, the new one rises from below, and the
 * whole value briefly flashes green.
 *
 * Formatting is caller-supplied via `format` (default: locale integer) so the same
 * component works for raw counts, percentages, and durations. Only the numeric
 * `value` drives the animation; the formatted string is what renders.
 *
 * Respects prefers-reduced-motion: the roll is skipped, only the value updates.
 */
export function AnimatedCount({
  value,
  format = (n) => n.toLocaleString(),
  className = '',
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const [flash, setFlash] = useState<'up' | null>(null);
  const [rollKey, setRollKey] = useState(0);
  const prevRef = useRef(value);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (value === prev) return;
    prevRef.current = value;
    setDisplay(value);
    // Trigger a fresh roll animation on every change.
    setRollKey((k) => k + 1);
    // Green flash only on increase (a landing/order went up).
    if (value > prev) {
      setFlash('up');
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 900);
    }
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [value]);

  const text = format(display);

  return (
    <span
      className={`inline-flex tabular-nums transition-colors duration-300 ${
        flash === 'up' ? 'text-emerald-500 dark:text-emerald-400' : ''
      } ${className}`}
      style={{ overflow: 'hidden', lineHeight: 1.1 }}
    >
      {/* key forces a remount so the CSS keyframe replays on each change */}
      <span key={rollKey} className="animated-count-roll">
        {text}
      </span>
      <style>{`
        @keyframes animatedCountRollUp {
          0%   { transform: translateY(60%); opacity: 0; }
          100% { transform: translateY(0);   opacity: 1; }
        }
        .animated-count-roll {
          display: inline-block;
          animation: animatedCountRollUp 380ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @media (prefers-reduced-motion: reduce) {
          .animated-count-roll { animation: none; }
        }
      `}</style>
    </span>
  );
}
