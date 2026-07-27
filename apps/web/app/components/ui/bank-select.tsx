import { useMemo, useState } from 'react';
import { NIGERIAN_BANKS, resolveNigerianBank } from '@yannis/shared';
import { FormField } from './form-field';
import { SearchableSelect } from './searchable-select';

const BANK_OPTIONS = NIGERIAN_BANKS.map((b) => ({
  value: b.code,
  label: b.name,
  description: b.code,
}));

export interface BankSelectProps {
  /** Current bank name (controlled). */
  bankName?: string;
  /** Current bank code / NIP institution code (controlled). */
  bankCode?: string;
  /** Uncontrolled defaults when bankName/bankCode not controlled. */
  defaultBankName?: string | null;
  defaultBankCode?: string | null;
  onChange?: (next: { bankName: string; bankCode: string }) => void;
  /** Form field name for bank name (hidden input). */
  nameBankName?: string;
  /** Form field name for bank code (hidden input). */
  nameBankCode?: string;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  /** Show the NIP code under the select (read-only). Default true. */
  showCodeHint?: boolean;
}

/**
 * Searchable Nigerian bank picker. Selecting a bank sets both name and NIP code.
 * Renders hidden inputs so Remix/form posts receive `bankName` + `bankCode`.
 */
export function BankSelect({
  bankName: controlledName,
  bankCode: controlledCode,
  defaultBankName,
  defaultBankCode,
  onChange,
  nameBankName = 'bankName',
  nameBankCode = 'bankCode',
  label = 'Bank',
  hint,
  error,
  required,
  disabled,
  id = 'bank-select',
  placeholder = 'Select bank…',
  searchPlaceholder = 'Search banks…',
  className,
  showCodeHint = true,
}: BankSelectProps) {
  const initial = resolveNigerianBank({
    name: controlledName ?? defaultBankName,
    code: controlledCode ?? defaultBankCode,
  });

  const [internalName, setInternalName] = useState(
    initial?.name ?? controlledName ?? defaultBankName ?? '',
  );
  const [internalCode, setInternalCode] = useState(
    initial?.code ?? controlledCode ?? defaultBankCode ?? '',
  );

  const isControlled = controlledName !== undefined || controlledCode !== undefined;
  const bankName = isControlled ? (controlledName ?? '') : internalName;
  const bankCode = isControlled ? (controlledCode ?? '') : internalCode;

  const selectValue = useMemo(() => {
    const resolved = resolveNigerianBank({ name: bankName, code: bankCode });
    if (resolved) return resolved.code;
    // Keep unknown legacy values selectable so the field is not blank.
    if (bankCode) return bankCode;
    return '';
  }, [bankName, bankCode]);

  const options = useMemo(() => {
    const known = NIGERIAN_BANKS.some((b) => b.code === selectValue);
    if (!selectValue || known) return BANK_OPTIONS;
    return [
      {
        value: selectValue,
        label: bankName || selectValue,
        description: selectValue,
      },
      ...BANK_OPTIONS,
    ];
  }, [selectValue, bankName]);

  const handleChange = (code: string) => {
    const match = NIGERIAN_BANKS.find((b) => b.code === code);
    const nextName = match?.name ?? '';
    const nextCode = match?.code ?? '';
    if (!isControlled) {
      setInternalName(nextName);
      setInternalCode(nextCode);
    }
    onChange?.({ bankName: nextName, bankCode: nextCode });
  };

  const codeHint =
    showCodeHint && bankCode
      ? `Bank code: ${bankCode}`
      : showCodeHint
        ? 'Bank code fills in when you pick a bank.'
        : undefined;

  return (
    <FormField
      label={label}
      htmlFor={id}
      required={required}
      error={error}
      hint={hint ?? codeHint}
      className={className}
    >
      <SearchableSelect
        id={id}
        value={selectValue}
        onChange={handleChange}
        options={options}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        disabled={disabled}
        emptyText="No banks match your search"
        wrapperClassName="w-full"
      />
      <input type="hidden" name={nameBankName} value={bankName} />
      <input type="hidden" name={nameBankCode} value={bankCode} />
    </FormField>
  );
}
