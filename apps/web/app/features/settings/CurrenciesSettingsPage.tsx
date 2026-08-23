import { useEffect, useMemo, useState } from 'react';
import { useFetcher, type FetcherWithComponents } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { CompactTable } from '~/components/ui/compact-table';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { useFetcherToast } from '~/components/ui/toast';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { AFRICAN_COUNTRY_CURRENCIES, AFRICAN_CURRENCY_CODES, currencyForCountry, flagForCountry } from '@yannis/shared';
import type { CurrencyRow } from '~/lib/currencies.server';

interface Props {
  currencies: CurrencyRow[];
}

/**
 * Preset accent colours for a currency. Chosen to be distinct and readable on
 * both light and dark backgrounds (they tint an order number / amount inline).
 */
const CURRENCY_COLOR_PRESETS: { value: string; label: string }[] = [
  { value: '#22c55e', label: 'Green' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#f97316', label: 'Orange' },
  { value: '#eab308', label: 'Amber' },
  { value: '#14b8a6', label: 'Teal' },
  { value: '#ef4444', label: 'Red' },
];

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
  // Activate/Deactivate goes through a confirmation modal.
  const [toggleTarget, setToggleTarget] = useState<CurrencyRow | null>(null);

  const base = currencies.find((c) => c.isDefault);

  // Close modals on a successful mutation.
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      setAddOpen(false);
      setEditing(null);
      setFxFor(null);
      setToggleTarget(null);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Multi Country"
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
            render: (c) => {
              const accent = !c.isDefault ? c.color : null;
              return (
                <div className="flex items-center gap-2">
                  {accent && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: accent }}
                      aria-hidden
                    />
                  )}
                  <span className={accent ? 'font-semibold' : 'font-semibold text-app-fg'} style={accent ? { color: accent } : undefined}>{c.symbol}</span>
                  <span className={accent ? 'font-medium' : 'font-medium text-app-fg'} style={accent ? { color: accent } : undefined}>{c.code}</span>
                  {c.isDefault && <StatusBadge status="Default" variant="info" />}
                </div>
              );
            },
          },
          {
            key: 'country',
            header: 'Country',
            render: (c) => {
              const flag = flagForCountry(c.countryName);
              return (
                <span className="text-app-muted-fg">
                  {flag && <span className="mr-1.5" aria-hidden>{flag}</span>}
                  {c.countryName}
                </span>
              );
            },
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
                  <Button variant="ghost" size="sm" onClick={() => setToggleTarget(c)}>
                    {c.active ? 'Deactivate' : 'Activate'}
                  </Button>
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

      {/* Activate / Deactivate confirmation */}
      <ConfirmActionModal
        open={toggleTarget != null}
        onClose={() => setToggleTarget(null)}
        title={toggleTarget?.active ? 'Deactivate currency' : 'Activate currency'}
        description={
          toggleTarget
            ? toggleTarget.active
              ? `Deactivate ${toggleTarget.symbol} ${toggleTarget.code}? It stops appearing in currency dropdowns and new records, but existing ${toggleTarget.code} orders and totals stay valid.`
              : `Activate ${toggleTarget.symbol} ${toggleTarget.code}? It becomes selectable again in currency dropdowns and on new records.`
            : ''
        }
        confirmLabel={toggleTarget?.active ? 'Deactivate' : 'Activate'}
        variant={toggleTarget?.active ? 'danger' : 'warning'}
        loading={fetcher.state === 'submitting'}
        onConfirm={() => {
          if (!toggleTarget) return;
          fetcher.submit(
            {
              intent: 'toggleActive',
              id: toggleTarget.id,
              active: toggleTarget.active ? 'false' : 'true',
            },
            { method: 'post' },
          );
        }}
      />

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
  // Accent colour — tints this currency's order#/amount so its rows stand out.
  const [color, setColor] = useState<string>(editing?.color ?? '');

  // When country changes, cascade code + symbol (add mode only — identity fixed on edit).
  const onCountryChange = (value: string) => {
    setCountry(value);
    const cur = currencyForCountry(value);
    setCode(cur?.code ?? '');
    setSymbol(cur?.symbol ?? '');
  };

  const fxNum = Number(fxRate);
  const fxValid = String(fxRate).trim() !== '' && Number.isFinite(fxNum) && fxNum > 0;

  const precision = editing?.precision ?? selected?.precision ?? AFRICAN_CURRENCY_CODES.find((c) => c.code === code)?.precision ?? 2;
  // On add, block a code the company already has. On edit the code is its own — ignore.
  const codeExists = !isEdit && code !== '' && existing.has(code.toUpperCase());
  // FX rate is REQUIRED when adding a currency (needed for merged/FX aggregates).
  // On edit the FX rate is managed via the dedicated "FX rate" row, not here.
  const canSubmit =
    country !== '' && code !== '' && symbol !== '' && !codeExists && (isEdit || fxValid) && fetcher.state === 'idle';

  return (
    <fetcher.Form method="post" className="space-y-4 p-5">
      <input type="hidden" name="intent" value={isEdit ? 'update' : 'create'} />
      {isEdit && <input type="hidden" name="id" value={editing.id} />}
      <input type="hidden" name="precision" value={precision} />
      {/* Country/code always submit (locked in edit but still needed by the action). */}
      <input type="hidden" name="countryName" value={country} />
      <h2 className="text-lg font-semibold text-app-fg">{isEdit ? `Edit ${editing.code}` : 'Add currency'}</h2>

      {/* Code + Symbol are derived from the country, so they submit as hidden inputs. */}
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="symbol" value={symbol} />

      {/* 1. Country (first selection — drives the rest). Searchable, flag-prefixed. */}
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-app-fg">Country</span>
        <SearchableSelect
          value={country}
          onChange={onCountryChange}
          disabled={isEdit}
          placeholder="Select a country"
          searchPlaceholder="Search countries..."
          emptyText="No matching country"
          options={[
            ...AFRICAN_COUNTRY_CURRENCIES.map((c) => ({
              value: c.country,
              label:
                !isEdit && existing.has(c.code.toUpperCase())
                  ? `${c.country} (${c.code}, added)`
                  : `${c.country} (${c.code})`,
              leading: <span aria-hidden>{c.flag}</span>,
              disabled: !isEdit && existing.has(c.code.toUpperCase()),
            })),
            // Ensure the edited currency's country is always selectable even if not in the catalog.
            ...(isEdit && !AFRICAN_COUNTRY_CURRENCIES.some((c) => c.country === country) && country
              ? [{ value: country, label: country, leading: <span aria-hidden>{flagForCountry(country)}</span> }]
              : []),
          ]}
        />
      </label>

      {/* Code + Symbol are derived from the country selection, so they are not
          shown as fields here — only submitted via the hidden inputs above. */}

      {/* 3. FX rate — REQUIRED on add (needed for merged/FX aggregates). On edit
          it is managed via the row's "FX rate" action, so it stays optional here. */}
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-app-fg">
          FX to base: value of 1 {code || 'unit'} in {baseSymbol}{' '}
          <span className="font-normal text-app-muted-fg">{isEdit ? '(optional)' : '(required)'}</span>
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
            ? 'Pick a currency first.'
            : fxValid
              ? `1 ${code} = ${baseSymbol}${fxNum.toLocaleString('en-US', { maximumFractionDigits: 4 })}`
              : isEdit
                ? `1 ${code} = ${baseSymbol}?`
                : 'Required: enter how many base units 1 unit of this currency is worth.'}
        </span>
      </label>

      {/* 4. Accent colour (optional) — tints this currency's order#/amount. */}
      <input type="hidden" name="color" value={color} />
      <div className="block text-sm">
        <span className="mb-1 block font-medium text-app-fg">
          Accent colour <span className="font-normal text-app-muted-fg">(optional)</span>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {CURRENCY_COLOR_PRESETS.map((preset) => {
            const active = color.toLowerCase() === preset.value.toLowerCase();
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => setColor(active ? '' : preset.value)}
                aria-label={preset.label}
                aria-pressed={active}
                title={preset.label}
                className={`h-7 w-7 rounded-full border-2 transition-transform ${
                  active ? 'border-app-fg scale-110' : 'border-transparent hover:scale-105'
                }`}
                style={{ backgroundColor: preset.value }}
              />
            );
          })}
          {color && (
            <button
              type="button"
              onClick={() => setColor('')}
              className="ml-1 text-xs text-app-muted-fg underline hover:text-app-fg"
            >
              Clear
            </button>
          )}
        </div>
        <span className="mt-1 block text-xs text-app-muted-fg">
          {color
            ? 'This currency’s order number and amount are tinted this colour.'
            : 'No colour: order number and amount render in the default text colour.'}
        </span>
      </div>

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
