export type BrowserStep = { icon: string; text: string };
export type BrowserKind = 'chrome' | 'firefox' | 'safari' | 'edge' | 'other';

export function detectBrowser(): BrowserKind {
  if (typeof window === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\//.test(ua) && /Google Inc/.test(navigator.vendor ?? '')) return 'chrome';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua) && /Apple Computer/.test(navigator.vendor ?? '')) return 'safari';
  return 'other';
}

export function getDeniedSteps(browser: BrowserKind): BrowserStep[] {
  switch (browser) {
    case 'chrome':
      return [
        { icon: '🔒', text: 'Click the lock icon in the address bar' },
        { icon: '🔔', text: 'Find "Notifications" and change it to "Allow"' },
        { icon: '🔄', text: 'Reload the page' },
      ];
    case 'edge':
      return [
        { icon: '🔒', text: 'Click the lock icon in the address bar' },
        { icon: '⚙️', text: 'Click "Permissions for this site"' },
        { icon: '🔔', text: 'Set "Notifications" to "Allow"' },
        { icon: '🔄', text: 'Reload the page' },
      ];
    case 'firefox':
      return [
        { icon: '🛡️', text: 'Click the shield or info icon (ℹ️) in the address bar' },
        { icon: '🔔', text: 'Find "Notifications" and click "×" to clear the block' },
        { icon: '🔄', text: 'Reload the page and click Allow when prompted' },
      ];
    case 'safari':
      return [
        { icon: '⚙️', text: 'Open Safari → Settings → Websites' },
        { icon: '🔔', text: 'Click "Notifications" in the left panel' },
        { icon: '✅', text: 'Find this site and change it to "Allow"' },
        { icon: '🔄', text: 'Reload the page' },
      ];
    default:
      return [
        { icon: '🔒', text: 'Click the lock or info icon in the address bar' },
        { icon: '🔔', text: 'Find "Notifications" and set it to "Allow"' },
        { icon: '🔄', text: 'Reload the page' },
      ];
  }
}
