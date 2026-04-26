import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useFetcher, useRevalidator } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { Checkbox } from '~/components/ui/checkbox';
import { PageNotification } from '~/components/ui/page-notification';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { useFetcherToast } from '~/components/ui/toast';
import type { Campaign, CustomFormField } from './types';
import { CustomFieldsEditor } from './custom-fields-editor';
import { sortAndReindexCustomFields } from './custom-fields-order';

export interface MarketingFormEditPageProps {
  campaign: Campaign;
}

function isOptionOn(value: boolean | string | undefined): boolean {
  return value === true || value === 'true';
}

const DEFAULT_ACCENT = '#6366f1';

const FORMS_INDEX_ACTION = '/admin/marketing/forms';

const ActivateIcon = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const DeactivateIcon = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ArchiveIcon = (
  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
  </svg>
);

/**
 * Full-page edit: basic form settings + custom fields (same shape as new form), one save.
 * Activate / deactivate / archive use the forms index action (status-only) so they apply immediately.
 */
export function MarketingFormEditPage({ campaign }: MarketingFormEditPageProps) {
  const fetcher = useFetcher<{ error?: string }>();
  const statusFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const { revalidate } = useRevalidator();
  const [dismissedActionError, setDismissedActionError] = useState(false);
  const actionError = (fetcher.data as { error?: string } | undefined)?.error;

  const [confirmAction, setConfirmAction] = useState<{ type: 'deactivate' | 'archive' } | null>(null);

  useFetcherToast(statusFetcher.data, { successMessage: 'Status updated' });

  const cfg = campaign.formConfig;

  const initialFields = useMemo(
    () => sortAndReindexCustomFields((cfg?.customFields ?? []) as CustomFormField[]),
    [cfg?.customFields],
  );

  const [fields, setFields] = useState<CustomFormField[]>(initialFields);
  const [accentColor, setAccentColor] = useState(() => cfg?.accentColor ?? DEFAULT_ACCENT);

  useEffect(() => {
    setFields(sortAndReindexCustomFields((cfg?.customFields ?? []) as CustomFormField[]));
    setAccentColor(cfg?.accentColor ?? DEFAULT_ACCENT);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset when switching forms; avoid wiping edits on revalidate
  }, [campaign.id]);

  const customFieldsJson = useMemo(() => JSON.stringify(fields), [fields]);

  useEffect(() => {
    if (fetcher.state === 'submitting') setDismissedActionError(false);
  }, [fetcher.state]);

  useEffect(() => {
    if (statusFetcher.state === 'idle' && statusFetcher.data) {
      const result = statusFetcher.data as { success?: boolean };
      if (result.success) {
        revalidate();
        setConfirmAction(null);
      }
    }
  }, [statusFetcher.state, statusFetcher.data, revalidate]);

  const submitStatusChange = useCallback(
    (status: string) => {
      const formData = new FormData();
      formData.set('intent', 'updateFormStatus');
      formData.set('id', campaign.id);
      formData.set('status', status);
      statusFetcher.submit(formData, { method: 'post', action: FORMS_INDEX_ACTION });
    },
    [campaign.id, statusFetcher],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Edit form"
        description={
          <>
            Update settings for <span className="font-medium text-app-fg">{campaign.name}</span>.{' '}
            <Link to="/admin/marketing/forms" className="text-brand-600 dark:text-brand-400 hover:underline">
              Back to all forms
            </Link>
          </>
        }
      />

      {actionError && !dismissedActionError && (
        <PageNotification
          variant="error"
          message={actionError}
          durationMs={8000}
          onDismiss={() => setDismissedActionError(true)}
        />
      )}

      <fetcher.Form method="post" className="space-y-6" key={campaign.id}>
        <input type="hidden" name="intent" value="updateForm" />
        <input type="hidden" name="id" value={campaign.id} />
        <input type="hidden" name="customFields" value={customFieldsJson} readOnly />
        <input type="hidden" name="formAccentColor" value={accentColor} readOnly />

        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-app-fg">Basic settings</h2>
          <TextInput label="Form Name" name="name" required defaultValue={campaign.name} />
          <FormSelect
            label="Status"
            name="status"
            defaultValue={campaign.status}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
              { value: 'ARCHIVED', label: 'Archived' },
            ]}
          />

          <div className="border-t border-app-border pt-3">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mb-2">Form customization</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextInput name="formHeading" placeholder="Form heading" defaultValue={cfg?.heading ?? ''} />
              <TextInput name="formSubtitle" placeholder="Form subtitle" defaultValue={cfg?.subtitle ?? ''} />
              <TextInput name="formButtonText" placeholder="Button text" defaultValue={cfg?.buttonText ?? ''} />
              <div className="flex items-center gap-2 sm:col-span-1">
                <input
                  type="color"
                  aria-label="Accent color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="w-10 h-9 rounded border border-app-border cursor-pointer shrink-0"
                />
                <span className="text-sm text-app-fg-muted">Accent color (preview updates below)</span>
              </div>
              <TextInput
                name="successCallbackUrl"
                type="url"
                placeholder="Success URL (e.g. https://funnel.example.com/thank-you)"
                hint="Optional — full URL of your funnel's thank-you page. Skips the inline success message."
                defaultValue={cfg?.successCallbackUrl ?? ''}
                className="sm:col-span-2"
              />
            </div>
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mt-4 mb-2">Optional standard fields</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showDeliveryAddress" defaultChecked={isOptionOn(cfg?.showDeliveryAddress)} />
                <span className="text-sm text-app-fg-muted">Delivery Address</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showDeliveryNotes" defaultChecked={isOptionOn(cfg?.showDeliveryNotes)} />
                <span className="text-sm text-app-fg-muted">Delivery Notes</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showDeliveryState" defaultChecked={isOptionOn(cfg?.showDeliveryState)} />
                <span className="text-sm text-app-fg-muted">Delivery State</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showGender" defaultChecked={isOptionOn(cfg?.showGender)} />
                <span className="text-sm text-app-fg-muted">Gender</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showPreferredDeliveryDate" defaultChecked={isOptionOn(cfg?.showPreferredDeliveryDate)} />
                <span className="text-sm text-app-fg-muted">Preferred Delivery Date</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox name="showPaymentMethod" defaultChecked={isOptionOn(cfg?.showPaymentMethod)} />
                <span className="text-sm text-app-fg-muted">Payment method (Pay on delivery / Pay online)</span>
              </label>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-app-fg mb-2">Custom fields</h2>
          <CustomFieldsEditor
            fields={fields}
            onFieldsChange={setFields}
            accentColor={accentColor}
            footnote={
              <span>
                Standard field toggles are in <strong className="text-app-fg">Basic settings</strong> above. Submit once to
                save the form with these custom fields.
              </span>
            }
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" size="sm" loading={fetcher.state === 'submitting'} loadingText="Saving…">
            Save changes
          </Button>
          <Link to="/admin/marketing/forms" className="btn-secondary btn-sm inline-flex items-center justify-center">
            Cancel
          </Link>
        </div>
      </fetcher.Form>

      <div className="card space-y-3">
        <h2 className="text-sm font-semibold text-app-fg">Form availability</h2>
        <p className="text-sm text-app-fg-muted">
          Quick actions apply immediately. You can also change status in <strong className="text-app-fg">Basic settings</strong>{' '}
          and use <strong className="text-app-fg">Save changes</strong>.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {campaign.status === 'ACTIVE' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5 text-warning-700 dark:text-warning-400 border-warning-200 dark:border-warning-800"
              onClick={() => setConfirmAction({ type: 'deactivate' })}
            >
              {DeactivateIcon}
              Deactivate
            </Button>
          )}
          {campaign.status === 'INACTIVE' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5 text-success-700 dark:text-success-400"
              onClick={() => submitStatusChange('ACTIVE')}
              loading={statusFetcher.state === 'submitting'}
              loadingText="Activating…"
            >
              {ActivateIcon}
              Activate
            </Button>
          )}
          {campaign.status !== 'ARCHIVED' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5 text-danger-700 dark:text-danger-400 border-danger-200 dark:border-danger-800"
              onClick={() => setConfirmAction({ type: 'archive' })}
            >
              {ArchiveIcon}
              Archive
            </Button>
          )}
        </div>
      </div>

      {confirmAction && (
        <ConfirmActionModal
          open
          onClose={() => setConfirmAction(null)}
          title={confirmAction.type === 'deactivate' ? 'Deactivate form?' : `Archive "${campaign.name}"?`}
          description={
            confirmAction.type === 'deactivate' ? (
              <>
                <strong>{campaign.name}</strong> will no longer be active. You can activate it again later.
              </>
            ) : (
              <>
                <strong>{campaign.name}</strong> will be hidden from default lists.
              </>
            )
          }
          details={
            confirmAction.type === 'archive' ? (
              <ul className="list-disc list-inside text-sm text-app-fg-muted space-y-1">
                <li>Hidden from default campaign lists</li>
                <li>You can change status back anytime</li>
              </ul>
            ) : undefined
          }
          confirmLabel={confirmAction.type === 'deactivate' ? 'Deactivate' : 'Archive'}
          variant={confirmAction.type === 'deactivate' ? 'warning' : 'archive'}
          loading={statusFetcher.state === 'submitting'}
          onConfirm={() => {
            submitStatusChange(confirmAction.type === 'deactivate' ? 'INACTIVE' : 'ARCHIVED');
          }}
        />
      )}
    </div>
  );
}
