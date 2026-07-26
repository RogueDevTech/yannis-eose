import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import type { PayRole } from '~/features/hr/payroll-prd-types';

export interface PayrollProfileValues {
  payRoleId: string | null;
  employmentType: string;
  salaryBasis: string;
  taxStatus: string;
  reportsToUserId: string | null;
  crmLinked: boolean;
}

interface PayrollUserProfileSectionProps {
  values: PayrollProfileValues;
  payRoles: PayRole[];
  managerOptions: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (patch: Partial<PayrollProfileValues>) => void;
}

export function PayrollUserProfileSection({
  values,
  payRoles,
  managerOptions,
  disabled,
  onChange,
}: PayrollUserProfileSectionProps) {
  return (
    <div className="card space-y-4">
      <h2 className="text-lg font-semibold text-app-fg">Payroll profile</h2>
      <p className="text-xs text-app-fg-muted">
        Pay role, tax treatment, and reporting line used when generating monthly payroll batches.
      </p>

      <SearchableSelect
        id="payRoleId"
        label="Pay role"
        value={values.payRoleId ?? ''}
        onChange={(v) => onChange({ payRoleId: v || null })}
        disabled={disabled}
        placeholder="Select pay role"
        searchPlaceholder="Search pay roles..."
        options={payRoles.map((r) => ({ value: r.id, label: r.name }))}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormSelect
          label="Employment type"
          value={values.employmentType}
          disabled={disabled}
          onChange={(e) => onChange({ employmentType: e.target.value })}
          options={[
            { value: 'STAFF', label: 'Staff' },
            { value: 'CONTRACTOR_AGENCY', label: 'Contractor (agency)' },
          ]}
        />
        <FormSelect
          label="Salary basis"
          value={values.salaryBasis}
          disabled={disabled}
          onChange={(e) => onChange({ salaryBasis: e.target.value })}
          options={[
            { value: 'FORMULA_BASED', label: 'Formula based' },
            { value: 'FLAT_RATE', label: 'Flat rate' },
          ]}
        />
        <FormSelect
          label="Tax status"
          value={values.taxStatus}
          disabled={disabled}
          onChange={(e) => onChange({ taxStatus: e.target.value })}
          options={[
            { value: 'STANDARD_PAYE', label: 'Standard PAYE' },
            { value: 'EMPLOYER_SUBSIDIZED_PAYE', label: 'Employer subsidized PAYE' },
            { value: 'GROSS_NO_DEDUCTION', label: 'Gross (no deduction)' },
          ]}
        />
        <SearchableSelect
          id="reportsToUserId"
          label="Reports to"
          value={values.reportsToUserId ?? ''}
          onChange={(v) => onChange({ reportsToUserId: v || null })}
          disabled={disabled}
          placeholder="Optional manager"
          searchPlaceholder="Search staff..."
          options={managerOptions}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-app-fg">
        <input
          type="checkbox"
          checked={values.crmLinked}
          disabled={disabled}
          onChange={(e) => onChange({ crmLinked: e.target.checked })}
        />
        CRM linked (order metrics drive formula pay)
      </label>
    </div>
  );
}
