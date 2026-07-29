import { useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { AmountInput } from '~/components/ui/amount-input';
import { NairaPrice } from '~/components/ui/naira-price';
import type { PayePreviewResult } from './payroll-prd-types';

export function PayePreviewCalculator() {
  const previewFetcher = useFetcher<{ preview?: PayePreviewResult; error?: string }>();
  const [previewGross, setPreviewGross] = useState('250000');
  const [previewTaxStatus, setPreviewTaxStatus] = useState('STANDARD_PAYE');
  const [previewSubsidy, setPreviewSubsidy] = useState('');
  const previewResult = previewFetcher.data?.preview ?? null;
  const showSubsidyField = previewTaxStatus === 'EMPLOYER_SUBSIDIZED_PAYE';

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-app-fg">PAYE preview calculator</h3>
        <p className="text-xs text-app-fg-muted mt-0.5">
          Uses the default band engine on the server. Confirm thresholds against official FIRS
          publications before go-live.
        </p>
      </div>
      <previewFetcher.Form
        method="post"
        className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3"
      >
        <input type="hidden" name="intent" value="previewPaye" />
        <div className="w-full sm:w-44 min-w-0">
          <label className="block text-sm font-medium text-app-fg-muted mb-1">Monthly gross (₦)</label>
          <AmountInput
            name="monthlyGross"
            className="input w-full"
            value={previewGross}
            onChange={setPreviewGross}
          />
        </div>
        <div className="w-full sm:w-52 min-w-0">
          <FormSelect
            label="Tax status"
            name="taxStatus"
            value={previewTaxStatus}
            onChange={(e) => setPreviewTaxStatus(e.target.value)}
            options={[
              { value: 'STANDARD_PAYE', label: 'Standard PAYE' },
              { value: 'EMPLOYER_SUBSIDIZED_PAYE', label: 'Employer subsidized' },
              { value: 'GROSS_NO_DEDUCTION', label: 'Gross, no deduction' },
            ]}
          />
        </div>
        {showSubsidyField ? (
          <div className="w-full sm:w-40 min-w-0">
            <TextInput
              label="Employer subsidy %"
              name="employerSubsidyPercent"
              type="number"
              min={0}
              max={100}
              value={previewSubsidy}
              onChange={(e) => setPreviewSubsidy(e.target.value)}
            />
          </div>
        ) : (
          <input type="hidden" name="employerSubsidyPercent" value="" />
        )}
        <div className="w-full sm:w-auto shrink-0">
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            className="w-full sm:w-auto"
            loading={previewFetcher.state === 'submitting'}
            loadingText="Calculating…"
          >
            Preview PAYE
          </Button>
        </div>
      </previewFetcher.Form>

      {previewFetcher.data?.error ? (
        <p className="text-sm text-danger-600 dark:text-danger-400">{previewFetcher.data.error}</p>
      ) : null}

      {previewResult ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 pt-3 border-t border-app-border">
          <PreviewStat label="Monthly gross" value={<NairaPrice amount={previewResult.monthlyGross} />} />
          <PreviewStat label="Annual tax" value={<NairaPrice amount={previewResult.annualTax} />} />
          <PreviewStat label="Monthly PAYE" value={<NairaPrice amount={previewResult.monthlyPaye} />} />
          <PreviewStat label="Employee PAYE" value={<NairaPrice amount={previewResult.employeePaye} />} />
        </div>
      ) : null}

      {previewResult?.reliefBreakdown?.length ? (
        <div className="pt-1">
          <p className="text-2xs font-semibold uppercase tracking-wide text-app-fg-muted mb-1.5">
            Relief breakdown
          </p>
          <ul className="space-y-1">
            {previewResult.reliefBreakdown.map((r) => (
              <li key={r.name} className="flex justify-between gap-3 text-sm">
                <span className="text-app-fg-muted">{r.name}</span>
                <span className="font-medium tabular-nums text-app-fg">
                  <NairaPrice amount={r.amount} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-app-hover px-3 py-2">
      <p className="text-2xs text-app-fg-muted uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-app-fg mt-0.5">{value}</p>
    </div>
  );
}
