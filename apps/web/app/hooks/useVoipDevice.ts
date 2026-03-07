import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Debug info captured when VOIP init or device fails — for troubleshooting in prod.
 */
export interface VoipDebugInfo {
  /** Failure phase: token_fetch | token_parse | device_init | unknown */
  phase: string;
  /** HTTP status when phase is token_fetch */
  status?: number;
  /** Response body (truncated) when phase is token_fetch */
  responseBody?: string;
  /** Raw error message */
  errorMessage?: string;
  /** Error stack if available */
  stack?: string;
  /** Extra context (e.g. parsed response keys, Twilio error code) */
  raw?: string;
  /** ISO timestamp when the error occurred */
  timestamp: string;
}

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
  /** Last error debug details (for Technical details panel when error is set) */
  debugInfo: VoipDebugInfo | null;
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

/** Serialize any thrown value to a string for debugInfo.raw (always produce something). */
function serializeErrorRaw(err: unknown): string {
  if (err == null) return 'null';
  if (err instanceof Error) {
    const parts = [`name=${err.name}`, `message=${err.message}`];
    if (err.stack) parts.push(`stack=${err.stack}`);
    if (err.cause != null) parts.push(`cause=${err.cause instanceof Error ? err.cause.message : String(err.cause)}`);
    return parts.join('; ');
  }
  if (typeof err === 'object') {
    try {
      return JSON.stringify(err);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
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
    debugInfo: null,
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

  // ── Helper: set error + debug and log to console ─────────────────
  const setErrorWithDebug = useCallback((
    message: string,
    debug: VoipDebugInfo,
  ) => {
    const payload = { tag: '[VOIP]', ...debug };
    console.error('[VOIP] Init failed:', message, payload);
    setState((prev) => ({
      ...prev,
      connecting: false,
      error: message,
      debugInfo: debug,
    }));
  }, []);

  // ── Init device ────────────────────────────────────────────────
  const initDevice = useCallback(async () => {
    if (deviceRef.current) return; // Already initialized

    setState((prev) => ({ ...prev, connecting: true, error: null, debugInfo: null }));

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
        const debug: VoipDebugInfo = {
          phase: 'token_fetch',
          status: res.status,
          responseBody: errBody.length > 500 ? errBody.slice(0, 500) + '…' : errBody,
          errorMessage: message,
          timestamp: new Date().toISOString(),
        };
        setErrorWithDebug(message, debug);
        return;
      }

      let data: unknown;
      try {
        data = await res.json();
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : 'Invalid JSON from token endpoint';
        const debug: VoipDebugInfo = {
          phase: 'token_parse',
          errorMessage: msg,
          stack: parseErr instanceof Error ? parseErr.stack : undefined,
          raw: String(parseErr),
          timestamp: new Date().toISOString(),
        };
        setErrorWithDebug('Token response was not valid JSON.', debug);
        return;
      }

      const trpcResult = (data as { result?: { data?: { token?: string } }; token?: string })?.result?.data ?? data as { token?: string };
      const token = trpcResult?.token as string | undefined;

      if (!token) {
        const raw = JSON.stringify(
          typeof data === 'object' && data !== null
            ? Object.keys(data as object)
            : typeof data,
        );
        const debug: VoipDebugInfo = {
          phase: 'token_parse',
          errorMessage: 'No token in response',
          raw: `Response keys/top-level: ${raw}`,
          timestamp: new Date().toISOString(),
        };
        setErrorWithDebug('No token received from VOIP service', debug);
        return;
      }

      // Check if this is a mock token (dev mode without Twilio)
      if (token.startsWith('mock_token_')) {
        setState((prev) => ({
          ...prev,
          ready: true,
          connecting: false,
          error: null,
          debugInfo: null,
        }));
        return;
      }

      // Real Twilio mode — dynamically import the SDK
      let Device: typeof import('@twilio/voice-sdk').Device;
      try {
        const mod = await import('@twilio/voice-sdk');
        Device = mod.Device;
      } catch (importErr) {
        const msg = importErr instanceof Error ? importErr.message : String(importErr);
        const debug: VoipDebugInfo = {
          phase: 'sdk_import',
          errorMessage: msg,
          stack: importErr instanceof Error ? importErr.stack : undefined,
          raw: serializeErrorRaw(importErr),
          timestamp: new Date().toISOString(),
        };
        setErrorWithDebug(`Failed to load call SDK: ${msg}`, debug);
        return;
      }

      const device = new Device(token, {
        // @ts-expect-error Twilio types expect Codec[]; opus/pcmu are valid at runtime
        codecPreferences: ['opus', 'pcmu'],
        closeProtection: true,
        logLevel: 1, // warn
      });

      // Device events
      device.on('registered', () => {
        setState((prev) => ({ ...prev, ready: true, connecting: false, debugInfo: null }));
      });

      device.on('error', (err: { message?: string; code?: number; twilioError?: unknown }) => {
        const errMessage = err.message ?? 'VOIP device error';
        const debug: VoipDebugInfo = {
          phase: 'device_init',
          errorMessage: errMessage,
          raw: err.code != null ? `code=${err.code}` : undefined,
          timestamp: new Date().toISOString(),
        };
        if (err.twilioError != null) {
          try {
            debug.raw = (debug.raw ? debug.raw + '; ' : '') + `twilioError: ${JSON.stringify(err.twilioError)}`;
          } catch {
            debug.raw = (debug.raw ?? '') + '; twilioError: [non-serializable]';
          }
        }
        console.error('[VOIP] Device error:', errMessage, debug);
        setState((prev) => ({
          ...prev,
          error: errMessage,
          ready: false,
          debugInfo: debug,
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

      try {
        await device.register();
      } catch (registerErr) {
        const msg = registerErr instanceof Error ? registerErr.message : String(registerErr);
        const debug: VoipDebugInfo = {
          phase: 'device_register',
          errorMessage: msg,
          stack: registerErr instanceof Error ? registerErr.stack : undefined,
          raw: serializeErrorRaw(registerErr),
          timestamp: new Date().toISOString(),
        };
        setErrorWithDebug(`Call device registration failed: ${msg}`, debug);
        return;
      }
      deviceRef.current = device;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize VOIP device';
      const debug: VoipDebugInfo = {
        phase: 'unknown',
        errorMessage: message,
        stack: err instanceof Error ? err.stack : undefined,
        raw: serializeErrorRaw(err),
        timestamp: new Date().toISOString(),
      };
      setErrorWithDebug(message, debug);
    }
  }, [tokenUrl, onCallStatusChange, startDurationTimer, stopDurationTimer, setErrorWithDebug]);

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
      debugInfo: null,
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
