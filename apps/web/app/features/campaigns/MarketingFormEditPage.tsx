import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useFetcher, useRevalidator } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { PageNotification } from '~/components/ui/page-notification';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { useFetcherToast } from '~/components/ui/toast';
import type { Campaign, CustomFormField, StandardFieldConfig } from './types';
import { CustomFieldsEditor } from './custom-fields-editor';
import { sortAndReindexCustomFields } from './custom-fields-order';
import { FormFullPreview } from './form-full-preview';
import { normalizeStandardFields } from './standard-fields';
import { StandardFieldsEditor } from './standard-fields-editor';

export interface MarketingFormEditPageProps {
  campaign: Campaign;
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
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
    />
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
  const multiProduct = (campaign.productIds?.length ?? 0) > 1;

  const [fields, setFields] = useState<CustomFormField[]>(() =>
    sortAndReindexCustomFields((cfg?.customFields ?? []) as CustomFormField[]),
  );
  const [accentColor, setAccentColor] = useState(() => cfg?.accentColor ?? DEFAULT_ACCENT);
  const [formHeading, setFormHeading] = useState(() => cfg?.heading ?? '');
  const [formSubtitle, setFormSubtitle] = useState(() => cfg?.subtitle ?? '');
  const [formButtonText, setFormButtonText] = useState(() => cfg?.buttonText ?? '');
  const [successCallbackUrl, setSuccessCallbackUrl] = useState(() => cfg?.successCallbackUrl ?? '');
  const [standardFields, setStandardFields] = useState<StandardFieldConfig[]>(() => normalizeStandardFields(campaign.formConfig));

  useEffect(() => {
    const c = campaign.formConfig;
    setFields(sortAndReindexCustomFields((c?.customFields ?? []) as CustomFormField[]));
    setAccentColor(c?.accentColor ?? DEFAULT_ACCENT);
    setFormHeading(c?.heading ?? '');
    setFormSubtitle(c?.subtitle ?? '');
    setFormButtonText(c?.buttonText ?? '');
    setSuccessCallbackUrl(c?.successCallbackUrl ?? '');
    setStandardFields(normalizeStandardFields(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset when switching form
  }, [campaign.id]);

  const customFieldsJson = useMemo(() => JSON.stringify(fields), [fields]);
  const standardFieldsJson = useMemo(() => JSON.stringify(standardFields), [standardFields]);

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

  const statusActions = (
    <>
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
    </>
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
        actions={statusActions}
      />

      {actionError && !dismissedActionError && (
        <PageNotification
          variant="error"
          message={actionError}
          durationMs={8000}
          onDismiss={() => setDismissedActionError(true)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-6 items-start">
        <div className="min-w-0">
          <fetcher.Form method="post" className="space-y-6" key={campaign.id}>
            <input type="hidden" name="intent" value="updateForm" />
            <input type="hidden" name="id" value={campaign.id} />
            <input type="hidden" name="customFields" value={customFieldsJson} readOnly />
            <input type="hidden" name="standardFields" value={standardFieldsJson} readOnly />
            <input type="hidden" name="formAccentColor" value={accentColor} readOnly />

            <div className="card space-y-4">
              <h2 className="text-sm font-semibold text-app-fg">Basic settings</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextInput label="Form Name" name="name" required defaultValue={campaign.name} />
                <FormSelect
                  key={`status-${campaign.id}`}
                  label="Status"
                  name="status"
                  defaultValue={campaign.status}
                  options={[
                    { value: 'ACTIVE', label: 'Active' },
                    { value: 'INACTIVE', label: 'Inactive' },
                    { value: 'ARCHIVED', label: 'Archived' },
                  ]}
                />
              </div>

              <div className="border-t border-app-border pt-3">
                <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mb-2">Form customization</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TextInput
                    name="formHeading"
                    label="Form heading"
                    placeholder="Form heading"
                    value={formHeading}
                    onChange={(e) => setFormHeading(e.target.value)}
                  />
                  <TextInput
                    name="formSubtitle"
                    label="Form subtitle"
                    placeholder="Form subtitle"
                    value={formSubtitle}
                    onChange={(e) => setFormSubtitle(e.target.value)}
                  />
                  <TextInput
                    name="formButtonText"
                    label="Button text"
                    placeholder="Button text"
                    value={formButtonText}
                    onChange={(e) => setFormButtonText(e.target.value)}
                  />
                  <div className="flex items-center gap-2 sm:col-span-1">
                    <input
                      type="color"
                      aria-label="Accent color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="w-10 h-9 rounded border border-app-border cursor-pointer shrink-0"
                    />
                    <span className="text-sm text-app-fg-muted">Accent color (preview updates on the right)</span>
                  </div>
                  <TextInput
                    name="successCallbackUrl"
                    type="url"
                    label="Success URL (optional)"
                    placeholder="e.g. https://funnel.example.com/thank-you"
                    hint="Full URL of your thank-you page. Skips the inline success message when set."
                    value={successCallbackUrl}
                    onChange={(e) => setSuccessCallbackUrl(e.target.value)}
                    className="sm:col-span-2"
                  />
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-app-fg mb-2">Standard fields</h2>
              <StandardFieldsEditor fields={standardFields} onFieldsChange={setStandardFields} />
            </div>

            <div>
              <h2 className="text-sm font-semibold text-app-fg mb-2">Custom fields</h2>
              <CustomFieldsEditor
                fields={fields}
                onFieldsChange={setFields}
                footnote={
                  <span>
                    Standard field toggles are in <strong className="text-app-fg">Basic settings</strong> above. Submit once
                    to save the form with these custom fields.
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
        </div>

        <div className="min-w-0 space-y-2 self-start static lg:sticky lg:top-[calc(var(--header-height,3.5rem)+0.5rem)] z-[1] max-lg:mb-2">
          <p className="text-xs text-app-fg-muted font-medium">Live preview (hosted form)</p>
          <FormFullPreview
            heading={formHeading}
            subtitle={formSubtitle}
            buttonText={formButtonText}
            accentColor={accentColor}
            multiProduct={multiProduct}
            standardFields={standardFields}
            successCallbackUrl={successCallbackUrl}
            customFields={fields}
          />
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
