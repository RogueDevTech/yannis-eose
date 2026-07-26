import { useMemo, useState } from 'react';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { AmountInput } from '~/components/ui/amount-input';
import { Modal } from '~/components/ui/modal';
import type { PayRole } from '~/features/hr/payroll-prd-types';

export interface PayrollProfileValues {
  payRoleId: string | null;
  employmentType: string;
  salaryBasis: string;
  taxStatus: string;
  flatMonthlyAmount: string;
}

/** Map system roles to pay role categories they can be assigned to. */
const ROLE_CATEGORY_MAP: Record<string, string[]> = {
  CS_CLOSER: ['CS'],
  HEAD_OF_CS: ['CS', 'LEADERSHIP'],
  MEDIA_BUYER: ['MEDIA_BUYING'],
  HEAD_OF_MARKETING: ['MEDIA_BUYING', 'LEADERSHIP'],
  HEAD_OF_LOGISTICS: ['LOGISTICS', 'LEADERSHIP'],
  TPL_MANAGER: ['LOGISTICS'],
  TPL_RIDER: ['LOGISTICS'],
  STOCK_MANAGER: ['LOGISTICS', 'OPERATIONS'],
  HR_MANAGER: ['HR_ADMIN', 'OPERATIONS'],
  FINANCE_OFFICER: ['FINANCE', 'OPERATIONS'],
  BRANCH_ADMIN: ['HR_ADMIN', 'OPERATIONS'],
};

const PAY_ROLE_INFO = [
  {
    title: 'Pay role',
    description: 'Determines the payroll formula used to calculate this person\'s pay. Each pay role has a linked commission plan with base salary tiers, bonus rules, and allowances. The dropdown is filtered to show only roles matching this staff member\'s system role.',
  },
];

const SALARY_BASIS_INFO = [
  {
    title: 'Formula based',
    description: 'Pay is calculated from the linked pay role formula. Base salary, bonuses, and allowances are derived from performance metrics like delivery rate, CPA, and per-product tiers. Used for CS Closers, Media Buyers, and Heads.',
  },
  {
    title: 'Flat rate',
    description: 'Fixed monthly amount with no formula calculation. The engine skips all performance-based computations and pays the set amount directly. Used for drivers, cleaners, video editors, and other fixed-salary roles.',
  },
];

const TAX_STATUS_INFO: Record<string, { title: string; description: string }> = {
  STANDARD_PAYE: {
    title: 'Standard PAYE',
    description: 'Tax is deducted from the employee\'s gross pay before they receive it. This is the default for most staff. Example: Gross ₦200,000, PAYE ₦15,000, Net ₦185,000.',
  },
  EMPLOYER_SUBSIDIZED_PAYE: {
    title: 'Employer subsidized PAYE',
    description: 'The company pays some or all of the employee\'s tax on their behalf. The employee receives more of their gross, and the company absorbs the tax cost. Used for senior roles with employer subsidy rules in their formula.',
  },
  GROSS_NO_DEDUCTION: {
    title: 'Gross (no deduction)',
    description: 'No PAYE tax is calculated. The employee receives their full gross pay with zero tax deduction. Used for contractors, probation staff, or roles where tax is handled outside the system.',
  },
};

function InfoIcon({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); onClick(); }}
      className="ml-1 inline-flex items-center justify-center rounded-full text-app-fg-muted hover:text-brand-500 transition-colors"
      aria-label="More info"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" d="M12 16v-4m0-4h.01" />
      </svg>
    </button>
  );
}

interface PayrollUserProfileSectionProps {
  values: PayrollProfileValues;
  payRoles: PayRole[];
  /** System role of the user being edited. Used to filter pay roles by category. */
  userRole?: string;
  disabled?: boolean;
  onChange: (patch: Partial<PayrollProfileValues>) => void;
}

export function PayrollUserProfileSection({
  values,
  payRoles,
  userRole,
  disabled,
  onChange,
}: PayrollUserProfileSectionProps) {
  const [showPayRoleInfo, setShowPayRoleInfo] = useState(false);
  const [showSalaryBasisInfo, setShowSalaryBasisInfo] = useState(false);
  const [showTaxInfo, setShowTaxInfo] = useState(false);
  const filteredPayRoles = useMemo(() => {
    if (!userRole) return payRoles;
    const categories = ROLE_CATEGORY_MAP[userRole];
    if (!categories) return payRoles;
    return payRoles.filter((r) => categories.includes(r.category));
  }, [payRoles, userRole]);

  return (
    <div className="card space-y-4">
      <h2 className="text-lg font-semibold text-app-fg">Payroll profile</h2>
      <p className="text-xs text-app-fg-muted">
        Pay role and tax treatment used when generating monthly payroll batches.
      </p>

      <div>
        <div className="flex items-center gap-0.5 mb-1">
          <span className="text-sm font-medium text-app-fg-muted">Pay role</span>
          <InfoIcon onClick={() => setShowPayRoleInfo(true)} />
        </div>
        <SearchableSelect
          id="payRoleId"
          value={values.payRoleId ?? ''}
        onChange={(v) => onChange({ payRoleId: v || null })}
        disabled={disabled}
        placeholder="Select pay role"
        searchPlaceholder="Search pay roles..."
        options={filteredPayRoles.map((r) => ({ value: r.id, label: r.name }))}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-0.5 mb-1">
            <span className="text-sm font-medium text-app-fg-muted">Salary basis</span>
            <InfoIcon onClick={() => setShowSalaryBasisInfo(true)} />
          </div>
          <FormSelect
            value={values.salaryBasis}
            disabled={disabled}
            onChange={(e) => onChange({ salaryBasis: e.target.value })}
            options={[
              { value: 'FORMULA_BASED', label: 'Formula based' },
              { value: 'FLAT_RATE', label: 'Flat rate' },
            ]}
          />
        </div>
        {values.salaryBasis === 'FLAT_RATE' && (
          <div>
            <label className="block text-sm font-medium text-app-fg-muted mb-1">Monthly amount (₦)</label>
            <AmountInput
              name="flatMonthlyAmount"
              className="input"
              disabled={disabled}
              value={values.flatMonthlyAmount}
              onChange={(e) => onChange({ flatMonthlyAmount: e.target.value })}
            />
          </div>
        )}
        <div>
          <div className="flex items-center gap-0.5 mb-1">
            <span className="text-sm font-medium text-app-fg-muted">Tax status</span>
            <InfoIcon onClick={() => setShowTaxInfo(true)} />
          </div>
          <FormSelect
            value={values.taxStatus}
            disabled={disabled}
            onChange={(e) => onChange({ taxStatus: e.target.value })}
            options={[
              { value: 'STANDARD_PAYE', label: 'Standard PAYE' },
              { value: 'EMPLOYER_SUBSIDIZED_PAYE', label: 'Employer subsidized PAYE' },
              { value: 'GROSS_NO_DEDUCTION', label: 'Gross (no deduction)' },
            ]}
          />
        </div>
      </div>

      <Modal open={showPayRoleInfo} onClose={() => setShowPayRoleInfo(false)} maxWidth="max-w-md" contentClassName="p-5 space-y-4">
        <h3 className="text-base font-semibold text-app-fg">Pay role</h3>
        <div className="space-y-3">
          {PAY_ROLE_INFO.map((info) => (
            <div key={info.title} className="rounded-lg bg-app-hover p-3">
              <p className="text-xs text-app-fg-muted leading-relaxed">{info.description}</p>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setShowPayRoleInfo(false)} className="btn-secondary w-full py-2 text-sm">Got it</button>
      </Modal>

      <Modal open={showSalaryBasisInfo} onClose={() => setShowSalaryBasisInfo(false)} maxWidth="max-w-md" contentClassName="p-5 space-y-4">
        <h3 className="text-base font-semibold text-app-fg">Salary basis options</h3>
        <div className="space-y-3">
          {SALARY_BASIS_INFO.map((info) => (
            <div key={info.title} className="rounded-lg bg-app-hover p-3">
              <p className="text-sm font-medium text-app-fg">{info.title}</p>
              <p className="text-xs text-app-fg-muted mt-1 leading-relaxed">{info.description}</p>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setShowSalaryBasisInfo(false)} className="btn-secondary w-full py-2 text-sm">Got it</button>
      </Modal>

      <Modal open={showTaxInfo} onClose={() => setShowTaxInfo(false)} maxWidth="max-w-md" contentClassName="p-5 space-y-4">
        <h3 className="text-base font-semibold text-app-fg">Tax status options</h3>
        <div className="space-y-3">
          {Object.values(TAX_STATUS_INFO).map((info) => (
            <div key={info.title} className="rounded-lg bg-app-hover p-3">
              <p className="text-sm font-medium text-app-fg">{info.title}</p>
              <p className="text-xs text-app-fg-muted mt-1 leading-relaxed">{info.description}</p>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowTaxInfo(false)}
          className="btn-secondary w-full py-2 text-sm"
        >
          Got it
        </button>
      </Modal>
    </div>
  );
}
