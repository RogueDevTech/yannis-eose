import { useMemo, useState, useEffect, useRef } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { PageHeader } from '~/components/ui/page-header';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { useFetcherToast } from '~/components/ui/toast';
import type { Campaign, CustomFormField } from './types';
import { CustomFieldsEditor } from './custom-fields-editor';

export interface FormBuilderPageProps {
  campaign: Campaign;
}

/**
 * Two-pane form builder. Custom field list + preview live in `CustomFieldsEditor`; this page
 * adds save bar, exit confirm, and posts to the builder route action.
 */
export function FormBuilderPage({ campaign }: FormBuilderPageProps) {
  const initialFields = useMemo<CustomFormField[]>(() => {
    const raw = (campaign.formConfig?.customFields ?? []) as CustomFormField[];
    return [...raw].sort((a, b) => a.order - b.order).map((f, i) => ({ ...f, order: i }));
  }, [campaign.formConfig?.customFields]);

  const [fields, setFields] = useState<CustomFormField[]>(initialFields);
  const [confirmExit, setConfirmExit] = useState<{ to: string } | null>(null);

  const isDirty = useMemo(() => {
    if (fields.length !== initialFields.length) return true;
    return JSON.stringify(fields) !== JSON.stringify(initialFields);
  }, [fields, initialFields]);

  const saveFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(saveFetcher.data, { successMessage: 'Form saved' });
  const isSaving = saveFetcher.state !== 'idle';

  const lastResponseRef = useRef<unknown>(null);
  useEffect(() => {
    if (saveFetcher.state !== 'idle' || !saveFetcher.data) return;
    if (saveFetcher.data === lastResponseRef.current) return;
    lastResponseRef.current = saveFetcher.data;
    if (saveFetcher.data.success) {
      setFields((prev) => prev.map((f) => ({ ...f })));
    }
  }, [saveFetcher.state, saveFetcher.data]);

  const accentColor = campaign.formConfig?.accentColor ?? '#6366f1';

  function handleSave() {
    saveFetcher.submit(
      { intent: 'saveCustomFields', customFields: JSON.stringify(fields) },
      { method: 'post' },
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Form Builder"
        description={
          <>
            Editing <strong className="text-app-fg">{campaign.name}</strong>
            {' — '}
            <Link to="/admin/marketing/forms" className="text-brand-600 dark:text-brand-400 hover:underline">
              back to all forms
            </Link>
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => {
                if (isDirty) setConfirmExit({ to: '/admin/marketing/forms' });
                else window.location.assign('/admin/marketing/forms');
              }}
            >
              Exit
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="button"
              onClick={handleSave}
              loading={isSaving}
              loadingText="Saving…"
              disabled={!isDirty || isSaving}
            >
              {isDirty ? 'Save changes' : 'Saved'}
            </Button>
          </div>
        }
      />

      <CustomFieldsEditor
        fields={fields}
        onFieldsChange={setFields}
        accentColor={accentColor}
        footnote={
          <>
            Standard fields (Name, Phone, Address, etc.) are managed on the form&apos;s basic settings —
            edit those from the{' '}
            <Link to="/admin/marketing/forms" className="text-brand-500 hover:underline">
              forms list
            </Link>
            .
          </>
        }
      />

      {confirmExit && (
        <ConfirmActionModal
          open
          onClose={() => setConfirmExit(null)}
          title="Discard unsaved changes?"
          description="You have unsaved field changes. Leaving now will lose them."
          confirmLabel="Discard and exit"
          cancelLabel="Keep editing"
          variant="warning"
          onConfirm={() => {
            window.location.assign(confirmExit.to);
          }}
        />
      )}
    </div>
  );
}
