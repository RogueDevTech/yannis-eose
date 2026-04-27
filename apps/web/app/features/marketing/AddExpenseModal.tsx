import { useEffect, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { AmountInput } from '~/components/ui/amount-input';
import { FormField } from '~/components/ui/form-field';
import { FileUpload, type FileUploadUploadState } from '~/components/ui/file-upload';
import { NairaPrice } from '~/components/ui/naira-price';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { useToast } from '~/components/ui/toast';
import type { Campaign, Product, AdPlatform } from './types';

interface ExpenseLine {
  /** Local row key — not sent to server. */
  uid: string;
  campaignId: string;
  productId: string;
  spendAmount: string;
  platform: AdPlatform;
  adUrl: string;
  screenshotUrl: string;
  uploadState: FileUploadUploadState;
}

const PLATFORM_OPTIONS: Array<{ value: AdPlatform; label: string }> = [
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'TIKTOK', label: 'TikTok' },
  { value: 'GOOGLE', label: 'Google' },
];

let nextUid = 0;
const newLineUid = () => `line-${++nextUid}`;

function emptyLine(): ExpenseLine {
  return {
    uid: newLineUid(),
    campaignId: '',
    productId: '',
    spendAmount: '',
    platform: 'FACEBOOK',
    adUrl: '',
    screenshotUrl: '',
    uploadState: 'idle',
  };
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface AddExpenseModalProps {
  open: boolean;
  onClose: () => void;
  campaigns: Campaign[];
  products: Product[];
  /** Remix action URL (route that handles the `createAdSpendBatch` intent). */
  actionUrl: string;
  onSuccess?: () => void;
}

export function AddExpenseModal({
  open,
  onClose,
  campaigns,
  products,
  actionUrl,
  onSuccess,
}: AddExpenseModalProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const { toast } = useToast();
  const [spendDate, setSpendDate] = useState(todayYmd());
  const [lines, setLines] = useState<ExpenseLine[]>(() => [emptyLine()]);

  useEffect(() => {
    if (!open) {
      setLines([emptyLine()]);
      setSpendDate(todayYmd());
    }
  }, [open]);

  // Close + toast on successful submit. Failed submits stay open and surface
  // the error so the user can fix it without losing what they typed (this is
  // the "submit-driven modal" pattern used elsewhere — see MonthlyPayrolls).
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      toast.success(`Logged ${lines.length} expense line${lines.length === 1 ? '' : 's'}`);
      onSuccess?.();
      onClose();
    }
  }, [fetcher.state, fetcher.data, lines.length, onClose, onSuccess, toast]);

  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: p.name })),
    [products],
  );

  // Map campaignId → productIds[] for auto-fill. Falls back to the only allowed
  // product when a campaign has multiple but the MB is scoped to one.
  const campaignProductMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of campaigns) {
      if (Array.isArray(c.productIds) && c.productIds.length > 0) {
        m.set(c.id, c.productIds.filter((id): id is string => typeof id === 'string' && id.length > 0));
      }
    }
    return m;
  }, [campaigns]);

  const updateLine = (uid: string, patch: Partial<ExpenseLine>) => {
    setLines((rows) => rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  };
  const addLine = () => setLines((rows) => [...rows, emptyLine()]);
  const removeLine = (uid: string) =>
    setLines((rows) => (rows.length === 1 ? rows : rows.filter((r) => r.uid !== uid)));

  const onCampaignChange = (uid: string, campaignId: string) => {
    const prodIds = campaignProductMap.get(campaignId) ?? [];
    // If the campaign owns exactly one product, auto-fill it. Otherwise leave
    // the product picker open so the MB can choose explicitly — never guess
    // when there's ambiguity.
    const auto = prodIds.length === 1 ? prodIds[0]! : '';
    updateLine(uid, { campaignId, productId: auto });
  };

  const total = useMemo(
    () =>
      lines.reduce((acc, l) => {
        const n = Number(l.spendAmount.replace(/,/g, ''));
        return acc + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    [lines],
  );

  const allLinesValid = useMemo(
    () =>
      lines.every((l) => {
        const amt = Number(l.spendAmount.replace(/,/g, ''));
        return (
          l.campaignId &&
          l.productId &&
          l.screenshotUrl &&
          l.uploadState !== 'uploading' &&
          Number.isFinite(amt) &&
          amt > 0
        );
      }) && spendDate.length > 0,
    [lines, spendDate],
  );

  const handleSubmit = () => {
    if (!allLinesValid) return;
    const payload = lines.map((l) => ({
      campaignId: l.campaignId,
      productId: l.productId,
      spendAmount: Number(l.spendAmount.replace(/,/g, '')),
      screenshotUrl: l.screenshotUrl,
      platform: l.platform,
      ...(l.adUrl.trim() ? { adUrl: l.adUrl.trim() } : {}),
    }));
    const fd = new FormData();
    fd.set('intent', 'createAdSpendBatch');
    fd.set('spendDate', spendDate);
    fd.set('lines', JSON.stringify(payload));
    fetcher.submit(fd, { method: 'POST', action: actionUrl });
  };

  const submitting = fetcher.state !== 'idle';
  const error = fetcher.data?.error;

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-app-fg">Add Expense</h2>
        <FormField label="Date" htmlFor="add-expense-date">
          <TextInput
            id="add-expense-date"
            type="date"
            value={spendDate}
            onChange={(e) => setSpendDate(e.target.value)}
            max={todayYmd()}
          />
        </FormField>

        <div className="space-y-3">
          {lines.map((line, idx) => {
            const productOptionsForLine =
              line.campaignId && (campaignProductMap.get(line.campaignId)?.length ?? 0) > 0
                ? productOptions.filter((p) =>
                    campaignProductMap.get(line.campaignId)!.includes(p.value),
                  )
                : productOptions;
            return (
              <div
                key={line.uid}
                className="rounded-lg border border-app-border bg-app-elevated p-3 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-app-fg-muted">
                    Line {idx + 1}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeLine(line.uid)}
                    disabled={lines.length === 1}
                  >
                    Remove
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FormField label="Campaign" htmlFor={`${line.uid}-campaign`}>
                    <SearchableSelect
                      id={`${line.uid}-campaign`}
                      value={line.campaignId}
                      onChange={(v) => onCampaignChange(line.uid, v)}
                      options={[
                        { value: '', label: 'Select campaign' },
                        ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                      ]}
                      searchPlaceholder="Search campaigns..."
                    />
                  </FormField>
                  <FormField label="Product" htmlFor={`${line.uid}-product`}>
                    <SearchableSelect
                      id={`${line.uid}-product`}
                      value={line.productId}
                      onChange={(v) => updateLine(line.uid, { productId: v })}
                      options={[
                        { value: '', label: 'Select product' },
                        ...productOptionsForLine,
                      ]}
                      searchPlaceholder="Search products..."
                    />
                  </FormField>
                  <FormField label="Amount (₦)" htmlFor={`${line.uid}-amount`}>
                    <AmountInput
                      id={`${line.uid}-amount`}
                      value={line.spendAmount}
                      onChange={(v) => updateLine(line.uid, { spendAmount: v })}
                      placeholder="0.00"
                    />
                  </FormField>
                  <FormField label="Platform" htmlFor={`${line.uid}-platform`}>
                    <FormSelect
                      id={`${line.uid}-platform`}
                      value={line.platform}
                      onChange={(e) =>
                        updateLine(line.uid, { platform: e.target.value as AdPlatform })
                      }
                      options={PLATFORM_OPTIONS}
                    />
                  </FormField>
                  <FormField label="Ad URL (optional)" htmlFor={`${line.uid}-adurl`} className="md:col-span-2">
                    <TextInput
                      id={`${line.uid}-adurl`}
                      type="url"
                      value={line.adUrl}
                      onChange={(e) => updateLine(line.uid, { adUrl: e.target.value })}
                      placeholder="https://www.facebook.com/..."
                    />
                  </FormField>
                  <FormField label="Screenshot" htmlFor={`${line.uid}-shot`} required className="md:col-span-2">
                    <FileUpload
                      folder={S3_FOLDERS.SCREENSHOTS}
                      onUpload={(url) => updateLine(line.uid, { screenshotUrl: url })}
                      onUploadStateChange={(s) => updateLine(line.uid, { uploadState: s })}
                      required
                    />
                    {line.screenshotUrl && (
                      <p className="text-xs text-app-fg-muted mt-1 truncate">
                        Uploaded ✓
                      </p>
                    )}
                  </FormField>
                </div>
              </div>
            );
          })}
        </div>

        <Button type="button" variant="secondary" size="sm" onClick={addLine}>
          + Add another line
        </Button>

        <div className="flex items-center justify-between rounded-md bg-app-hover px-3 py-2">
          <span className="text-sm text-app-fg-muted">Total ({lines.length} line{lines.length === 1 ? '' : 's'})</span>
          <span className="font-semibold">
            <NairaPrice amount={total} />
          </span>
        </div>

        {error && (
          <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleSubmit}
            disabled={!allLinesValid || submitting}
          >
            {submitting ? 'Submitting…' : `Submit ${lines.length} line${lines.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
