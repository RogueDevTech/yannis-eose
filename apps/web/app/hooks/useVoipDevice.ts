import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * VOIP Device state — tracks the lifecycle of the Twilio WebRTC device
 * and the active call.
 */
export interface VoipDeviceState {
  /** Is the Device registered and ready? */
  ready: boolean;
  /** Is a call currently active? */
  onCall: boolean;
  /** Call status (INITIATED, RINGING, IN_PROGRESS, COMPLETED, FAILED, etc.) */
  callStatus: string | null;
  /** Call duration in seconds (updates live while on call) */
  callDuration: number;
  /** Is the call muted? */
  muted: boolean;
  /** Error message if device init or call fails */
  error: string | null;
  /** Is the device currently connecting? */
  connecting: boolean;
}

export interface UseVoipDeviceReturn extends VoipDeviceState {
  /** Initialize the device (fetches token + registers) */
  initDevice: () => Promise<void>;
  /** Mute / unmute the active call */
  toggleMute: () => void;
  /** Hang up the active call */
  hangUp: () => void;
  /** Destroy the device and clean up */
  destroy: () => void;
}

/**
 * useVoipDevice — manages a Twilio WebRTC Voice Device in the browser.
 *
 * Usage:
 *   const voip = useVoipDevice(); // token URL defaults to API + /trpc/voip.generateToken
 *   // On mount or when agent enters order page:
 *   voip.initDevice();
 *   // While on a call:
 *   voip.toggleMute();
 *   voip.hangUp();
 *   // On unmount:
 *   voip.destroy();
 *
 * When running without real Twilio creds (mock mode), the hook detects mock tokens
 * and simulates the device lifecycle.
 */
/**
 * URL used by the browser to fetch the VOIP token.
 * Always same-origin so the session cookie is sent (required when web and API
 * are on different domains, e.g. separate Cloudflare tunnels).
 */
const BROWSER_VOIP_TOKEN_URL = '/api/voip-token';

function getDefaultVoipTokenUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:4444/trpc/voip.generateToken';
  return BROWSER_VOIP_TOKEN_URL;
}

/** Turn a failed token response into a short, user-friendly message (no HTML dump). */
function formatVoipTokenError(status: number, bodyText: string): string {
  if (status === 401) {
    return 'Session expired. Please sign in again and try calling.';
  }
  if (status === 403) {
    return 'You don’t have permission to use the call service.';
  }
  if (status === 404 || status === 405) {
    return 'Call service is not reachable. Please ensure the API server is running and try again.';
  }
  if (status >= 500) {
    return 'The call service is temporarily unavailable. Please try again in a moment.';
  }
  // Avoid showing HTML or long technical messages
  const isHtml = bodyText.trimStart().startsWith('<');
  const looksLikeRemixError =
    bodyText.includes('routes/$') ||
    bodyText.includes('Method Not Allowed') ||
    bodyText.includes('action');
  if (isHtml || looksLikeRemixError || bodyText.length > 200) {
    return 'Could not connect to the call service. Please check that the API is running and try again.';
  }
  // Try to use a short JSON error message if present
  try {
    const json = JSON.parse(bodyText) as { message?: string; error?: string };
    const msg = json.message ?? json.error;
    if (typeof msg === 'string' && msg.length < 150) return msg;
  } catch {
    // ignore
  }
  return 'Could not connect to the call service. Please try again.';
}

export function useVoipDevice(opts: {
  fetchTokenUrl?: string;
  onCallStatusChange?: (status: string) => void;
}): UseVoipDeviceReturn {
  const { fetchTokenUrl = getDefaultVoipTokenUrl(), onCallStatusChange } = opts;
  // In browser, always use same-origin proxy so cookie is sent (ignore any override to API URL)
  const tokenUrl =
    typeof window !== 'undefined' ? BROWSER_VOIP_TOKEN_URL : fetchTokenUrl;

  const [state, setState] = useState<VoipDeviceState>({
    ready: false,
    onCall: false,
    callStatus: null,
    callDuration: 0,
    muted: false,
    error: null,
    connecting: false,
  });

  // Refs for cleanup
  const deviceRef = useRef<unknown>(null);
  const callRef = useRef<unknown>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStartRef = useRef<number>(0);

  // ── Duration timer ─────────────────────────────────────────────
  const startDurationTimer = useCallback(() => {
    callStartRef.current = Date.now();
    durationTimerRef.current = setInterval(() => {
      setState((prev) => ({
        ...prev,
        callDuration: Math.floor((Date.now() - callStartRef.current) / 1000),
      }));
    }, 1000);
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  // ── Init device ────────────────────────────────────────────────
  const initDevice = useCallback(async () => {
    if (deviceRef.current) return; // Already initialized

    setState((prev) => ({ ...prev, connecting: true, error: null }));

    try {
      // Fetch the access token from the API
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!res.ok) {
        const errBody = await res.text();
        const message = formatVoipTokenError(res.status, errBody);
        throw new Error(message);
      }

      const data = await res.json();
      const trpcResult = data?.result?.data ?? data;
      const token = trpcResult?.token as string | undefined;

      if (!token) {
        throw new Error('No token received from VOIP service');
      }

      // Check if this is a mock token (dev mode without Twilio)
      if (token.startsWith('mock_token_')) {
        setState((prev) => ({
          ...prev,
          ready: true,
          connecting: false,
          error: null,
        }));
        return;
      }

      // Real Twilio mode — dynamically import the SDK
      const { Device } = await import('@twilio/voice-sdk');

      const device = new Device(token, {
        codecPreferences: ['opus', 'pcmu'] as unknown as Device.Codec[],
        closeProtection: true,
        logLevel: 1, // warn
      });

      // Device events
      device.on('registered', () => {
        setState((prev) => ({ ...prev, ready: true, connecting: false }));
      });

      device.on('error', (err: { message?: string }) => {
        setState((prev) => ({
          ...prev,
          error: err.message ?? 'VOIP device error',
          ready: false,
        }));
      });

      device.on('incoming', (call: {
        accept: () => void;
        on: (event: string, handler: (...args: unknown[]) => void) => void;
        mute: (muted?: boolean) => void;
        disconnect: () => void;
        isMuted: () => boolean;
      }) => {
        // Auto-accept incoming calls (the agent clicked Call, Twilio bridges back)
        call.accept();
        callRef.current = call;

        setState((prev) => ({
          ...prev,
          onCall: true,
          callStatus: 'IN_PROGRESS',
          callDuration: 0,
          muted: false,
        }));

        startDurationTimer();
        onCallStatusChange?.('IN_PROGRESS');

        call.on('disconnect', () => {
          callRef.current = null;
          stopDurationTimer();
          setState((prev) => ({
            ...prev,
            onCall: false,
            callStatus: 'COMPLETED',
          }));
          onCallStatusChange?.('COMPLETED');
        });

        call.on('cancel', () => {
          callRef.current = null;
          stopDurationTimer();
          setState((prev) => ({
            ...prev,
            onCall: false,
            callStatus: 'FAILED',
          }));
          onCallStatusChange?.('FAILED');
        });
      });

      await device.register();
      deviceRef.current = device;
    } catch (err) {
      setState((prev) => ({
        ...prev,
        connecting: false,
        error: err instanceof Error ? err.message : 'Failed to initialize VOIP device',
      }));
    }
  }, [tokenUrl, onCallStatusChange, startDurationTimer, stopDurationTimer]);

  // ── Toggle mute ────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const call = callRef.current as { mute?: (muted?: boolean) => void; isMuted?: () => boolean } | null;
    if (call && typeof call.mute === 'function') {
      const newMuted = !(call.isMuted?.() ?? state.muted);
      call.mute(newMuted);
      setState((prev) => ({ ...prev, muted: newMuted }));
    } else {
      // Mock mode — just toggle the state
      setState((prev) => ({ ...prev, muted: !prev.muted }));
    }
  }, [state.muted]);

  // ── Hang up ────────────────────────────────────────────────────
  const hangUp = useCallback(() => {
    const call = callRef.current as { disconnect?: () => void } | null;
    if (call && typeof call.disconnect === 'function') {
      call.disconnect();
    }
    callRef.current = null;
    stopDurationTimer();
    setState((prev) => ({
      ...prev,
      onCall: false,
      callStatus: 'COMPLETED',
    }));
    onCallStatusChange?.('COMPLETED');
  }, [onCallStatusChange, stopDurationTimer]);

  // ── Destroy ────────────────────────────────────────────────────
  const destroy = useCallback(() => {
    stopDurationTimer();
    const device = deviceRef.current as { destroy?: () => void } | null;
    if (device && typeof device.destroy === 'function') {
      device.destroy();
    }
    deviceRef.current = null;
    callRef.current = null;
    setState({
      ready: false,
      onCall: false,
      callStatus: null,
      callDuration: 0,
      muted: false,
      error: null,
      connecting: false,
    });
  }, [stopDurationTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    ...state,
    initDevice,
    toggleMute,
    hangUp,
    destroy,
  };
}
