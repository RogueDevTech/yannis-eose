/**
 * Global install chip/banner (root prompt + iOS banner). When dismissed, promos stay hidden;
 * Settings → Profile still shows the full "Install app" card (`/admin/settings#install-app`).
 */
export const INSTALL_PROMOTION_DISMISSED_KEY = 'yannis_install_promotion_dismissed';

const LEGACY_IOS_DISMISS_COUNT_KEY = 'ios_banner_dismissed_count';

function legacyIosBannerFullyDismissed(): boolean {
  try {
    const n = parseInt(localStorage.getItem(LEGACY_IOS_DISMISS_COUNT_KEY) ?? '0', 10);
    return Number.isFinite(n) && n >= 3;
  } catch {
    return false;
  }
}

export function isInstallPromotionDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (localStorage.getItem(INSTALL_PROMOTION_DISMISSED_KEY) === '1') return true;
    return legacyIosBannerFullyDismissed();
  } catch {
    return false;
  }
}

export function dismissInstallPromotion(): void {
  try {
    localStorage.setItem(INSTALL_PROMOTION_DISMISSED_KEY, '1');
  } catch {
    // storage denied — promos may reappear; Settings install still works
  }
}
