/**
 * Demo card showing multiple loading styles side by side.
 * Pick one; then we can replace the overlay content with just that variant.
 */
import { useState, useEffect } from 'react';
import { Spinner } from './spinner';

const ROTATING_MESSAGES = ['Loading…', 'Almost there…', 'Getting your data…'];

export function RouteLoaderVariants() {
  return (
    <div className="rounded-xl bg-app-elevated shadow-xl border border-app-border p-6 max-w-4xl">
      <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mb-4 text-center">
        Pick a loading style
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
        {/* 1. Current spinner */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 flex items-center justify-center">
            <Spinner size="lg" className="text-brand-500 dark:text-brand-400" />
          </div>
          <span className="text-xs text-app-fg-muted">Spinner</span>
        </div>

        {/* 2. Logo pulse */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 flex items-center justify-center">
            <img
              src="/assets/yannis-logo1.png"
              alt=""
              className="h-8 w-auto object-contain animate-pulse opacity-90"
            />
          </div>
          <span className="text-xs text-app-fg-muted">Logo pulse</span>
        </div>

        {/* 3. Orbit dots */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 flex items-center justify-center relative">
            <div className="absolute w-10 h-10 animate-orbit">
              <span
                className="absolute top-1/2 left-1/2 w-2 h-2 rounded-full bg-brand-500 dark:bg-brand-400 -mt-1 -ml-1"
                style={{ transform: 'translate(16px, 0)' }}
              />
              <span
                className="absolute top-1/2 left-1/2 w-2 h-2 rounded-full bg-brand-500/70 dark:bg-brand-400/70 -mt-1 -ml-1"
                style={{ transform: 'rotate(120deg) translate(16px, 0)' }}
              />
              <span
                className="absolute top-1/2 left-1/2 w-2 h-2 rounded-full bg-brand-500/40 dark:bg-brand-400/40 -mt-1 -ml-1"
                style={{ transform: 'rotate(240deg) translate(16px, 0)' }}
              />
            </div>
          </div>
          <span className="text-xs text-app-fg-muted">Orbit</span>
        </div>

        {/* 4. Gradient stroke spinner */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 flex items-center justify-center">
            <svg
              className="w-10 h-10 animate-spin text-brand-500 dark:text-brand-400"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="32 32"
                strokeDashoffset="8"
                opacity="0.9"
              />
            </svg>
          </div>
          <span className="text-xs text-app-fg-muted">Gradient</span>
        </div>

        {/* 5. Progress arc */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 flex items-center justify-center">
            <svg className="w-10 h-10 -rotate-90" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="2"
                className="text-app-border"
                fill="none"
              />
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="47 47"
                strokeDashoffset="12"
                className="text-brand-500 dark:text-brand-400 animate-arc"
                fill="none"
              />
            </svg>
          </div>
          <span className="text-xs text-app-fg-muted">Arc</span>
        </div>

        {/* 6. Bouncing dots */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 flex items-center justify-center gap-1">
            <span className="w-2 h-2 rounded-full bg-brand-500 dark:bg-brand-400 animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 rounded-full bg-brand-500 dark:bg-brand-400 animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 rounded-full bg-brand-500 dark:bg-brand-400 animate-bounce [animation-delay:300ms]" />
          </div>
          <span className="text-xs text-app-fg-muted">Dots</span>
        </div>

        {/* 7. Rotating text */}
        <div className="flex flex-col items-center gap-2 col-span-2 sm:col-span-3 md:col-span-4 lg:col-span-6">
          <RotatingMessage />
          <span className="text-xs text-app-fg-muted">Rotating text</span>
        </div>
      </div>
    </div>
  );
}

function RotatingMessage() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % ROTATING_MESSAGES.length);
    }, 1500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="h-6 flex items-center justify-center min-w-[160px]">
      <span className="text-sm font-medium text-app-fg-muted transition-opacity duration-300">
        {ROTATING_MESSAGES[index]}
      </span>
    </div>
  );
}
