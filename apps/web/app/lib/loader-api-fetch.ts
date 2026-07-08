import { extractApiErrorMessage } from '~/lib/api-error';
import { isApiNetworkFailure } from '~/lib/api.server';

export type LoaderApiFailureResponse = { ok: boolean; status: number; data: unknown };

/**
 * User-facing message when a Remix loader's `apiRequest` fails (timeout, network, or tRPC error).
 * Pair with optional `*LoadError` fields passed to the route instead of silent empty lists.
 */
export function describeApiFetchFailure(label: string, res: LoaderApiFailureResponse): string {
  if (res.status === 504) {
    return `${label} timed out before the API responded. Try Reload data. The service may still be warming up.`;
  }
  if (isApiNetworkFailure(res)) {
    return `${label} could not be reached. Check that the API is running, then try Reload data.`;
  }
  const detail = extractApiErrorMessage(res.data, '');
  return detail ? `${label}: ${detail}` : `${label} failed (${res.status}). Try Reload data.`;
}
