/**
 * Yannis EOSE — Notification sound
 *
 * A short, distinctive six-tone chime generated with Web Audio API.
 * Mature and professional; unique to this product (not a generic messaging sound).
 * No external file — works offline and is consistent across environments.
 *
 * Browsers require a user gesture before playing sound. Call unlockAudioContext()
 * on first user interaction (e.g. first click in the app) so that later
 * playNotificationSound() works when notifications arrive.
 */

const AUDIO_CONTEXT_KEY = '__yannis_notification_audio_context' as const;

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as Record<string, unknown>;
  // If a previous context was closed/interrupted, discard it so we create a fresh one
  const existing = win[AUDIO_CONTEXT_KEY] as AudioContext | undefined;
  if (existing && existing.state === 'closed') {
    win[AUDIO_CONTEXT_KEY] = undefined;
  }
  if (!win[AUDIO_CONTEXT_KEY]) {
    try {
      win[AUDIO_CONTEXT_KEY] = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return win[AUDIO_CONTEXT_KEY] as AudioContext;
}

/**
 * Call this on first user interaction (e.g. click) to unlock audio.
 * Until then, browsers may block playNotificationSound().
 */
export function unlockAudioContext(): void {
  const ctx = getOrCreateAudioContext();
  if (!ctx || ctx.state === 'running') return;
  ctx.resume().catch(() => {});
}

/**
 * Play a six-note chime (C5 → E5 → G5 → C6 → E6 → G6) with soft attack and gentle decay.
 * For sound to be heard, the user must have interacted with the page first (unlockAudioContext).
 */
export function playNotificationSound(): void {
  if (typeof window === 'undefined') return;

  const ctx = getOrCreateAudioContext();
  if (!ctx) return;

  // Always resume — browsers can re-suspend the context after periods of inactivity
  const doPlay = () => {
    if (ctx.state !== 'running') return;
    try {
      const playTone = (frequency: number, startTime: number, duration: number, gainValue: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, startTime);
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(gainValue, startTime + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      const now = ctx.currentTime;
      const vol = 0.45;
      playTone(523.25, now, 0.24, vol);             // C5
      playTone(659.25, now + 0.10, 0.25, vol * 0.95);   // E5
      playTone(783.99, now + 0.20, 0.25, vol * 0.9);    // G5
      playTone(1046.5, now + 0.30, 0.26, vol * 0.85);   // C6
      playTone(1318.5, now + 0.40, 0.26, vol * 0.8);    // E6
      playTone(1568.0, now + 0.50, 0.28, vol * 0.75);   // G6
    } catch {
      // Ignore errors (e.g. context closed)
    }
  };

  if (ctx.state === 'running') {
    doPlay();
  } else {
    // Context suspended — resume first, then play once running
    ctx.resume().then(doPlay).catch(() => {});
  }
}
