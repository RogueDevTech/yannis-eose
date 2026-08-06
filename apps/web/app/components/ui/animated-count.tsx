import { useEffect, useRef, useState } from 'react';

/**
 * AnimatedCount — a number that "rolls" like an odometer when it changes and flashes
 * green on an increase. On a live increment (e.g. 5 → 6) the OLD value slides up and
 * out while the NEW value rises from below into its place, so the switch is clearly
 * visible — not just a swap. A date-range / filter change (big jump or a drop) snaps
 * instantly with no roll, so all tiles update together and never look out of sync.
 *
 * Formatting is caller-supplied via `format` (default: locale integer) so the same
 * component works for raw counts, percentages, and durations.
 *
 * Respects prefers-reduced-motion: the roll is skipped; the value updates in place.
 */
const ROLL_MS = 700; // slow enough to read the old→new transition
const FLASH_MS = 1100;

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
  const [rolling, setRolling] = useState<{ from: number; to: number; key: number } | null>(null);
  const [flash, setFlash] = useState(false);
  const prevRef = useRef(value);
  const keyRef = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (value === prev) return;
    prevRef.current = value;

    const delta = value - prev;
    // Only roll + flash on a genuine live increment (small positive bump). A large
    // jump or any decrease = a filter change → snap instantly.
    const isLiveIncrement = delta > 0 && delta <= 25;

    if (!isLiveIncrement) {
      setRolling(null);
      setDisplay(value);
      return;
    }

    keyRef.current += 1;
    setRolling({ from: prev, to: value, key: keyRef.current });
    setFlash(true);
    if (rollTimer.current) clearTimeout(rollTimer.current);
    rollTimer.current = setTimeout(() => {
      setDisplay(value);
      setRolling(null);
    }, ROLL_MS);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), FLASH_MS);

    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (rollTimer.current) clearTimeout(rollTimer.current);
    };
  }, [value]);

  return (
    <span
      className={`inline-flex tabular-nums transition-colors duration-500 ${
        flash ? 'text-emerald-500 dark:text-emerald-400' : ''
      } ${className}`}
      style={{ position: 'relative', overflow: 'hidden', lineHeight: 1.15, verticalAlign: 'bottom' }}
    >
      {rolling ? (
        // Odometer: old value slides up and out, new value rises from below.
        <span key={rolling.key} className="animated-count-stack" style={{ display: 'inline-block', position: 'relative' }}>
          <span className="animated-count-old" style={{ display: 'block' }}>{format(rolling.from)}</span>
          <span className="animated-count-new" style={{ display: 'block', position: 'absolute', top: 0, left: 0 }}>
            {format(rolling.to)}
          </span>
        </span>
      ) : (
        <span style={{ display: 'inline-block' }}>{format(display)}</span>
      )}
      <style>{`
        @keyframes animatedCountOldUp {
          0%   { transform: translateY(0);     opacity: 1; }
          100% { transform: translateY(-110%); opacity: 0; }
        }
        @keyframes animatedCountNewUp {
          0%   { transform: translateY(110%);  opacity: 0; }
          60%  { opacity: 1; }
          100% { transform: translateY(0);     opacity: 1; }
        }
        .animated-count-old { animation: animatedCountOldUp ${ROLL_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards; }
        .animated-count-new { animation: animatedCountNewUp ${ROLL_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        @media (prefers-reduced-motion: reduce) {
          .animated-count-old { display: none !important; }
          .animated-count-new { position: static !important; animation: none !important; }
        }
      `}</style>
    </span>
  );
}
