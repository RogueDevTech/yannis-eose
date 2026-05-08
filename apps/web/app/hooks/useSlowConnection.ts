import { useEffect, useState } from 'react';
import { useNavigation } from '@remix-run/react';

/**
 * Slow-connection detection for the route-loading toast.
 *
 * Combines two signals:
 *   1. Navigation state — `useNavigation().state === 'loading'` held longer than
 *      `SLOW_LOAD_THRESHOLD_MS`. This catches cold APIs, retries (where the first
 *      attempt failed and the second is succeeding), and slow DB queries — the
 *      "is this loader stuck?" signal regardless of network quality.
 *   2. Network Information API — `navigator.connection.effectiveType` of
 *      `slow-2g | 2g | 3g`, or `saveData: true`. Surfaces immediately on a known
 *      slow connection so users see the signal even if the request happens to be
 *      fast for that network class.
 *
 * The hook is harmless to mount anywhere: returns `false` during SSR (no
 * `navigator`), and unmounts cleanly. Mount once per layout — DashboardLayout,
 * TplLayout, RiderLayout — so the toast appears in every shell.
 */

/** How long a navigation must stay 'loading' before we call it slow. */
const SLOW_LOAD_THRESHOLD_MS = 3_000;

export type SlowConnectionReason =
  /** Loader is taking longer than `SLOW_LOAD_THRESHOLD_MS`. Most common cause on prod. */
  | 'slow-load'
  /** Browser reports user is on a known-slow network class (2g / 3g / save-data). */
  | 'slow-network';

export interface SlowConnectionState {
  isSlow: boolean;
  reason: SlowConnectionReason | null;
}

interface NetworkConnectionInfo {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  addEventListener?: (event: 'change', handler: () => void) => void;
  removeEventListener?: (event: 'change', handler: () => void) => void;
}

/** Read `navigator.connection` (Network Information API — not on TS types yet). */
function readNetworkInfo(): NetworkConnectionInfo | null {
  if (typeof navigator === 'undefined') return null;
  const conn = (navigator as unknown as { connection?: NetworkConnectionInfo }).connection;
  return conn ?? null;
}

/** Classify the current network class. False on desktop / 4G / unknown. */
function isKnownSlowNetwork(): boolean {
  const conn = readNetworkInfo();
  if (!conn) return false;
  if (conn.saveData === true) return true;
  const t = conn.effectiveType;
  return t === 'slow-2g' || t === '2g' || t === '3g';
}

/**
 * `true` while the active navigation has exceeded the slow-load threshold,
 * OR the user is on a known-slow connection during any active navigation.
 */
export function useSlowConnection(): SlowConnectionState {
  const navigation = useNavigation();
  const [slowLoad, setSlowLoad] = useState(false);
  const [slowNetwork, setSlowNetwork] = useState(false);

  // Re-check the Network Information API on mount + whenever it fires `change`.
  useEffect(() => {
    const update = () => setSlowNetwork(isKnownSlowNetwork());
    update();
    const conn = readNetworkInfo();
    if (conn?.addEventListener) {
      conn.addEventListener('change', update);
      return () => conn.removeEventListener?.('change', update);
    }
    return undefined;
  }, []);

  // Watch the navigation state — flag as slow once it's been loading past the threshold.
  useEffect(() => {
    if (navigation.state !== 'loading' && navigation.state !== 'submitting') {
      setSlowLoad(false);
      return;
    }
    const timer = setTimeout(() => setSlowLoad(true), SLOW_LOAD_THRESHOLD_MS);
    return () => clearTimeout(timer);
  }, [navigation.state]);

  if (slowLoad) return { isSlow: true, reason: 'slow-load' };
  if (slowNetwork && (navigation.state === 'loading' || navigation.state === 'submitting')) {
    return { isSlow: true, reason: 'slow-network' };
  }
  return { isSlow: false, reason: null };
}
