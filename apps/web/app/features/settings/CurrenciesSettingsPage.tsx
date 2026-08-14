import { useEffect, useMemo, useState } from 'react';
import { useFetcher, type FetcherWithComponents } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { CompactTable } from '~/components/ui/compact-table';
import { useFetcherToast } from '~/components/ui/toast';
import { AFRICAN_COUNTRY_CURRENCIES, AFRICAN_CURRENCY_CODES, currencyForCountry } from '@yannis/shared';
import type { CurrencyRow } from '~/lib/currencies.server';

interface Props {
  currencies: CurrencyRow[];
}

/** Format the stored numeric FX string for display. */
function fxLabel(row: CurrencyRow, base: CurrencyRow | undefined): string {
  if (row.isDefault) return 'Base';
  if (row.fxRateToBase == null) return 'Not set';
  const baseSym = base?.symbol ?? '';
  return `1 ${row.symbol} = ${baseSym}${Number(row.fxRateToBase).toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
}

export function CurrenciesSettingsPage({ currencies }: Props) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(fetcher, { successMessage: 'Saved' });

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<CurrencyRow | null>(null);
  const [fxFor, setFxFor] = useState<CurrencyRow | null>(null);

  const base = currencies.find((c) => c.isDefault);

  // Close modals on a successful mutation.
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      setAddOpen(false);
      setEditing(null);
      setFxFor(null);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Country & Currency"
        backTo="/admin/settings"
        mobileInlineActions
        actions={<Button onClick={() => setAddOpen(true)}>Add currency</Button>}
      />

      <CompactTable
        rows={currencies}
        rowKey={(c) => c.id}
        emptyTitle="No currencies configured"
        emptyDescription="Add your first currency to get started."
        columns={[
          {
            key: 'currency',
            header: 'Currency',
            render: (c) => (
              <div className="flex items-center gap-2">
                <span className="font-semibold text-app-fg">{c.symbol}</span>
                <span className="font-medium text-app-fg">{c.code}</span>
                {c.isDefault && <StatusBadge status="Default" variant="info" />}
              </div>
            ),
          },
          {
            key: 'country',
            header: 'Country',
            render: (c) => <span className="text-app-muted-fg">{c.countryName}</span>,
          },
          {
            key: 'fx',
            header: 'FX to base',
            hideOnMobile: true,
            render: (c) => <span className="text-app-muted-fg">{fxLabel(c, base)}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            render: (c) => (
              <StatusBadge status={c.active ? 'Active' : 'Inactive'} variant={c.active ? 'success' : 'neutral'} />
            ),
          },
          {
            key: 'actions',
            header: '',
            mobileLabel: 'Actions',
            mobileShowLabel: false,
            align: 'right',
            hideable: false,
            render: (c) =>
              // The default (base) currency is locked: it can't be edited,
              // deactivated, re-based, or given an FX rate. Show a muted note.
              c.isDefault ? (
                <span className="text-xs text-app-muted-fg">Base currency (locked)</span>
              ) : (
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setFxFor(c)}>
                    FX rate
                  </Button>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="toggleActive" />
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="active" value={c.active ? 'false' : 'true'} />
                    <Button type="submit" variant="ghost" size="sm">
                      {c.active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </fetcher.Form>
                </div>
              ),
          },
        ]}
      />

      {/* Add currency — country-driven (pick a country, code + symbol auto-fill) */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)}>
        <CurrencyForm
          key={addOpen ? 'open' : 'closed'}
          fetcher={fetcher}
          existingCodes={currencies.map((c) => c.code)}
          baseSymbol={base?.symbol ?? '₦'}
          onCancel={() => setAddOpen(false)}
        />
      </Modal>

      {/* Edit currency — same layout as Add (country-driven form) */}
      <Modal open={editing != null} onClose={() => setEditing(null)}>
        {editing && (
          <CurrencyForm
            key={editing.id}
            fetcher={fetcher}
            existingCodes={currencies.map((c) => c.code)}
            baseSymbol={base?.symbol ?? '₦'}
            editing={editing}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>

      {/* Set FX rate */}
      <Modal open={fxFor != null} onClose={() => setFxFor(null)}>
        {fxFor && (
          <fetcher.Form method="post" className="space-y-4 p-5">
            <input type="hidden" name="intent" value="setFxRate" />
            <input type="hidden" name="id" value={fxFor.id} />
            <h2 className="text-lg font-semibold text-app-fg">FX rate for {fxFor.code}</h2>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-app-fg">
                1 {fxFor.symbol} equals how many {base?.symbol ?? base?.code ?? 'base'}?
              </span>
              <TextInput
                name="fxRate"
                type="number"
                step="0.0001"
                min={0}
                defaultValue={fxFor.fxRateToBase ?? ''}
                placeholder="210"
                required
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setFxFor(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={fetcher.state !== 'idle'}>
                Save rate
              </Button>
            </div>
          </fetcher.Form>
        )}
      </Modal>
    </div>
  );
}

/**
 * Country-driven currency form, shared by ADD and EDIT so both look identical.
 * Country is the FIRST selection; picking it pre-fills Code + Symbol (all
 * dropdowns). Africa-first catalog. In EDIT mode the country/code identity is
 * fixed (locked selects) — only symbol, precision, and FX can change.
 */
function CurrencyForm({
  fetcher,
  existingCodes,
  baseSymbol,
  onCancel,
  editing,
}: {
  fetcher: FetcherWithComponents<{ success?: boolean; error?: string }>;
  existingCodes: string[];
  baseSymbol: string;
  onCancel: () => void;
  /** When set, the form edits this currency instead of creating a new one. */
  editing?: CurrencyRow;
}) {
  const isEdit = editing != null;
  const existing = useMemo(() => new Set(existingCodes.map((c) => c.toUpperCase())), [existingCodes]);

  const [country, setCountry] = useState(editing?.countryName ?? '');
  const selected = currencyForCountry(country);
  const [code, setCode] = useState(editing?.code ?? '');
  const [symbol, setSymbol] = useState(editing?.symbol ?? '');
  const [fxRate, setFxRate] = useState(editing?.fxRateToBase ?? '');

  // When country changes, cascade code + symbol (add mode only — identity fixed on edit).
  const onCountryChange = (value: string) => {
    setCountry(value);
    const cur = currencyForCountry(value);
    setCode(cur?.code ?? '');
    setSymbol(cur?.symbol ?? '');
  };
  const onCodeChange = (value: string) => {
    setCode(value);
    const match = AFRICAN_CURRENCY_CODES.find((c) => c.code === value);
    if (match) setSymbol(match.symbol);
  };

  const fxNum = Number(fxRate);
  const fxValid = String(fxRate).trim() !== '' && Number.isFinite(fxNum) && fxNum > 0;

  const precision = editing?.precision ?? selected?.precision ?? AFRICAN_CURRENCY_CODES.find((c) => c.code === code)?.precision ?? 2;
  // On add, block a code the company already has. On edit the code is its own — ignore.
  const codeExists = !isEdit && code !== '' && existing.has(code.toUpperCase());
  const canSubmit = country !== '' && code !== '' && symbol !== '' && !codeExists && fetcher.state === 'idle';

  return (
    <fetcher.Form method="post" className="space-y-4 p-5">
      <input type="hidden" name="intent" value={isEdit ? 'update' : 'create'} />
      {isEdit && <input type="hidden" name="id" value={editing.id} />}
      <input type="hidden" name="precision" value={precision} />
      {/* Country/code always submit (locked in edit but still needed by the action). */}
      <input type="hidden" name="countryName" value={country} />
      <h2 className="text-lg font-semibold text-app-fg">{isEdit ? `Edit ${editing.code}` : 'Add currency'}</h2>

      {/* 1. Country (first selection — drives the rest) */}
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-app-fg">Country</span>
        <FormSelect
          value={country}
          onChange={(e) => onCountryChange(e.target.value)}
          disabled={isEdit}
          options={[
            { value: '', label: 'Select a country' },
            ...AFRICAN_COUNTRY_CURRENCIES.map((c) => ({
              value: c.country,
              label: !isEdit && existing.has(c.code.toUpperCase()) ? `${c.country} (${c.code}, added)` : `${c.country} (${c.code})`,
              disabled: !isEdit && existing.has(c.code.toUpperCase()),
            })),
            // Ensure the edited currency's country is always selectable even if not in the catalog.
            ...(isEdit && !AFRICAN_COUNTRY_CURRENCIES.some((c) => c.country === country) && country
              ? [{ value: country, label: country }]
              : []),
          ]}
        />
      </label>

      {/* 2. Code + Symbol (auto-filled from country, still dropdowns) */}
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-app-fg">Currency code</span>
          <FormSelect
            name="code"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            disabled={isEdit || !country}
            options={[
              { value: '', label: 'Select' },
              ...AFRICAN_CURRENCY_CODES.map((c) => ({ value: c.code, label: c.code })),
              ...(code && !AFRICAN_CURRENCY_CODES.some((c) => c.code === code) ? [{ value: code, label: code }] : []),
            ]}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-app-fg">Symbol</span>
          <FormSelect
            name="symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            disabled={!code}
            options={[
              ...(symbol && !AFRICAN_CURRENCY_CODES.some((c) => c.symbol === symbol)
                ? [{ value: symbol, label: symbol }]
                : []),
              ...AFRICAN_CURRENCY_CODES.map((c) => ({ value: c.symbol, label: `${c.symbol}  (${c.code})` })),
            ]}
          />
        </label>
      </div>

      {/* 3. FX rate (optional; can also be set later per row) */}
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-app-fg">
          FX to base: value of 1 {code || 'unit'} in {baseSymbol}{' '}
          <span className="font-normal text-app-muted-fg">(optional)</span>
        </span>
        <TextInput
          name="fxRate"
          type="number"
          step="0.0001"
          min={0}
          placeholder="e.g. 210"
          disabled={!code}
          value={fxRate}
          onChange={(e) => setFxRate(e.target.value)}
          leftAddon={baseSymbol}
        />
        <span className="mt-1 block text-xs text-app-muted-fg">
          {!code
            ? 'Pick a currency first. You can also set this later.'
            : fxValid
              ? `1 ${code} = ${baseSymbol}${fxNum.toLocaleString('en-US', { maximumFractionDigits: 4 })}`
              : `1 ${code} = ${baseSymbol}?`}
        </span>
      </label>

      {codeExists && (
        <p className="text-xs text-red-500">{code} is already configured for this company.</p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {isEdit ? 'Save' : 'Add currency'}
        </Button>
      </div>
    </fetcher.Form>
  );
}
