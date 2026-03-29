import { useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return !!(
    'standalone' in window.navigator &&
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Hook to manage PWA install prompt.
 * Returns whether the app can be installed and a function to trigger the prompt.
 * On iOS (Safari or Chrome/WebKit), there is no beforeinstallprompt — use manual Add to Home Screen steps.
 */
export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIosManualInstall, setIsIosManualInstall] = useState(false);

  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua);
    const standalone = isStandaloneDisplayMode();

    if (standalone) {
      setIsInstalled(true);
      setIsIosManualInstall(false);
    } else {
      setIsIosManualInstall(isIos);
    }

    if (standalone) {
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setIsIosManualInstall(false);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome === 'accepted';
  }, [deferredPrompt]);

  return {
    canInstall: !!deferredPrompt && !isInstalled,
    isInstalled,
    /** True when iOS and not already running as installed PWA — user must use Share → Add to Home Screen. */
    isIosManualInstall,
    /** @deprecated Use isIosManualInstall — same value (all iOS WebKit browsers, not Safari-only). */
    isIosSafariLike: isIosManualInstall,
    canPromptInstall: !isInstalled && (!!deferredPrompt || isIosManualInstall),
    install,
  };
}
