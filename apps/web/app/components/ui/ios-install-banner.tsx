import { useState, useEffect } from 'react';
import { dismissInstallPromotion, isInstallPromotionDismissed } from '~/lib/install-promotion-dismiss';

function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    !!('standalone' in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone) ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

export function IosInstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isIOS()) return;
    if (isStandalone()) return;
    if (isInstallPromotionDismissed()) return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  const handleDismiss = () => {
    dismissInstallPromotion();
    setVisible(false);
  };

  return (
    <div
      className="fixed bottom-16 left-0 right-0 z-50 mx-3 mb-2 animate-slide-in-right"
      role="banner"
      aria-label="Install app banner"
    >
      <div className="flex items-center gap-3 rounded-xl bg-indigo-600 px-4 py-3 shadow-lg">
        {/* Share icon */}
        <svg
          className="h-6 w-6 flex-shrink-0 text-white"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.8}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z"
          />
        </svg>

        <p className="flex-1 text-sm leading-snug text-white">
          For call and order alerts on your lock screen —{' '}
          <strong>Tap Share</strong> then{' '}
          <strong>&ldquo;Add to Home Screen&rdquo;</strong>
        </p>

        {/* Dismiss button */}
        <button
          type="button"
          onClick={handleDismiss}
          className="ml-1 flex-shrink-0 rounded-full p-1 text-indigo-100 transition-colors hover:bg-indigo-500 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Dismiss install banner"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
