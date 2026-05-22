const STORAGE_KEY = 'yannis_notification_sound_enabled';

export function isNotificationSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = localStorage.getItem(STORAGE_KEY);
  // Default: enabled
  return stored !== 'false';
}

export function setNotificationSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
}
