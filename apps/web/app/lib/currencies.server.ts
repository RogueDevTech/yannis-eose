import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie } from './api.server';
import { extractApiErrorMessage } from './api-error';

export interface CurrencyRow {
  id: string;
  groupId: string | null;
  code: string;
  symbol: string;
  countryName: string;
  precision: number;
  isDefault: boolean;
  active: boolean;
  fxRateToBase: string | null;
  fxRateUpdatedAt: string | null;
}

/** Load the full currency list (incl. inactive) for the config panel. */
export async function loadCurrenciesPageData(request: Request): Promise<{ currencies: CurrencyRow[] }> {
  const cookie = getSessionCookie(request);
  const res = await apiRequest<unknown>('/trpc/currencies.list?input=' + encodeURIComponent(JSON.stringify({})), {
    method: 'GET',
    cookie,
  });
  if (!res.ok) return { currencies: [] };
  const rows = (res.data as { result?: { data?: CurrencyRow[] } })?.result?.data ?? [];
  return { currencies: rows };
}

/** Handle the config panel mutations (intent-dispatched). Returns JSON action data. */
export async function handleCurrenciesForm(request: Request, formData: FormData) {
  const cookie = getSessionCookie(request);
  const intent = String(formData.get('intent') ?? '');

  const post = async (proc: string, body: Record<string, unknown>, fallback: string) => {
    const res = await apiRequest<unknown>(`/trpc/${proc}`, { method: 'POST', cookie, body });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, fallback) }, { status: 400 });
    return json({ success: true });
  };

  switch (intent) {
    case 'create': {
      const fxRaw = formData.get('fxRate')?.toString()?.trim();
      const fxRate = fxRaw && Number(fxRaw) > 0 ? Number(fxRaw) : undefined;
      return post(
        'currencies.create',
        {
          code: String(formData.get('code') ?? ''),
          symbol: String(formData.get('symbol') ?? ''),
          countryName: String(formData.get('countryName') ?? ''),
          precision: Number(formData.get('precision') ?? 2),
          isDefault: false,
          active: true,
          // Optional FX at creation; admin can also set/change it later per row.
          ...(fxRate !== undefined ? { fxRate } : {}),
        },
        'Failed to add currency',
      );
    }
    case 'update': {
      const id = String(formData.get('id') ?? '');
      // 1. Update editable fields (symbol/country/precision).
      const res = await apiRequest<unknown>('/trpc/currencies.update', {
        method: 'POST',
        cookie,
        body: {
          id,
          symbol: String(formData.get('symbol') ?? ''),
          countryName: String(formData.get('countryName') ?? ''),
          precision: Number(formData.get('precision') ?? 2),
        },
      });
      if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to update currency') }, { status: 400 });
      // 2. If an FX rate was entered, set it too (Edit form carries the FX field).
      const fxRaw = formData.get('fxRate')?.toString()?.trim();
      const fxRate = fxRaw && Number(fxRaw) > 0 ? Number(fxRaw) : undefined;
      if (fxRate !== undefined) {
        const fxRes = await apiRequest<unknown>('/trpc/currencies.setFxRate', { method: 'POST', cookie, body: { id, fxRate } });
        if (!fxRes.ok) return json({ error: extractApiErrorMessage(fxRes.data, 'Failed to set FX rate') }, { status: 400 });
      }
      return json({ success: true });
    }
    case 'toggleActive':
      return post(
        'currencies.update',
        { id: String(formData.get('id') ?? ''), active: formData.get('active') === 'true' },
        'Failed to change status',
      );
    case 'setFxRate':
      return post(
        'currencies.setFxRate',
        { id: String(formData.get('id') ?? ''), fxRate: Number(formData.get('fxRate') ?? 0) },
        'Failed to set FX rate',
      );
    case 'setDefault':
      return post('currencies.setDefault', { id: String(formData.get('id') ?? '') }, 'Failed to set default');
    default:
      return json({ error: 'Unknown action' }, { status: 400 });
  }
}
