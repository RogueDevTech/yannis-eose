import { useState, useMemo } from 'react';
import { Form, useFetcher, useNavigation } from '@remix-run/react';
import { Breadcrumb } from '~/components/ui/breadcrumb';
import { Button } from '~/components/ui/button';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { FormField } from '~/components/ui/form-field';
import { FormSelect } from '~/components/ui/form-select';
import { PageHeader } from '~/components/ui/page-header';
import { StatusBadge } from '~/components/ui/status-badge';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { FileUpload } from '~/components/ui/file-upload';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { useFetcherToast } from '~/components/ui/toast';

type OnboardingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED';

export interface OnboardingRecord {
  userId: string;
  status: OnboardingStatus;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY' | null;
  dateOfBirth: string | null;
  residentialAddress: string | null;
  proofOfAddressUrl: string | null;
  supportingDocuments: Array<{ label: string; url: string }>;
  guarantor1Name: string | null;
  guarantor1Phone: string | null;
  guarantor1Email: string | null;
  guarantor1Address: string | null;
  guarantor1Relationship: string | null;
  guarantor1LetterUrl: string | null;
  guarantor2Name: string | null;
  guarantor2Phone: string | null;
  guarantor2Email: string | null;
  guarantor2Address: string | null;
  guarantor2Relationship: string | null;
  guarantor2LetterUrl: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
}

export interface StaffOnboardingPageProps {
  /** Subject of the page — the staff member whose onboarding is being viewed/edited. */
  subject: { id: string; name: string };
  /** Current onboarding record (synthetic NOT_STARTED placeholder when no row yet). */
  record: OnboardingRecord;
  /**
   * `self`  — the actor IS the subject. Form follows lock rules (SUBMITTED/APPROVED → read-only).
   * `hr`    — the actor is HR / admin viewing someone else. Always editable; Approve shown when SUBMITTED.
   */
  mode: 'self' | 'hr';
  /** Action endpoint — defaults to current route. */
  actionUrl?: string;
  /** When true, show breadcrumb back to /hr/users/:id. */
  showBackToProfile?: boolean;
  approverName?: string | null;
}

const GENDER_OPTIONS = [
  { value: '', label: 'Select…' },
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' },
];

function formatStatusLabel(status: OnboardingStatus): string {
  switch (status) {
    case 'NOT_STARTED':
      return 'Not started';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'SUBMITTED':
      return 'Pending HR review';
    case 'APPROVED':
      return 'Approved';
  }
}

export function StaffOnboardingPage({
  subject,
  record,
  mode,
  actionUrl,
  showBackToProfile,
  approverName,
}: StaffOnboardingPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const navigation = useNavigation();

  useFetcherToast(fetcher.data, { successMessage: 'Onboarding saved' });

  // Lock rules: staff lose write access once SUBMITTED or APPROVED. HR keeps writing.
  const lockedForStaff = record.status === 'SUBMITTED' || record.status === 'APPROVED';
  const readOnly = mode === 'self' && lockedForStaff;

  const [proofUrl, setProofUrl] = useState(record.proofOfAddressUrl ?? '');
  const [g1Letter, setG1Letter] = useState(record.guarantor1LetterUrl ?? '');
  const [g2Letter, setG2Letter] = useState(record.guarantor2LetterUrl ?? '');
  const [supportingDocs, setSupportingDocs] = useState(record.supportingDocuments);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);

  const isSavingDraft =
    fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'updateOnboarding';
  const isSubmitting =
    fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'submitOnboarding';
  const isApproving =
    fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'approveOnboarding';

  const submittedDate = useMemo(
    () => (record.submittedAt ? new Date(record.submittedAt).toLocaleDateString('en-NG', { dateStyle: 'medium' }) : null),
    [record.submittedAt],
  );
  const approvedDate = useMemo(
    () => (record.approvedAt ? new Date(record.approvedAt).toLocaleDateString('en-NG', { dateStyle: 'medium' }) : null),
    [record.approvedAt],
  );

  const handleSaveDraft = (formEl: HTMLFormElement) => {
    const fd = new FormData(formEl);
    fd.set('intent', 'updateOnboarding');
    fd.set('proofOfAddressUrl', proofUrl);
    fd.set('guarantor1LetterUrl', g1Letter);
    fd.set('guarantor2LetterUrl', g2Letter);
    fd.set('supportingDocuments', JSON.stringify(supportingDocs));
    fetcher.submit(fd, { method: 'post', action: actionUrl });
  };

  return (
    <div className="space-y-4">
      {showBackToProfile ? (
        <Breadcrumb
          items={[
            { label: 'HR', to: '/hr/users' },
            { label: subject.name, to: `/hr/users/${subject.id}` },
            { label: 'Onboarding' },
          ]}
        />
      ) : null}

      <PageHeader
        title={mode === 'self' ? 'Your onboarding' : `Onboarding · ${subject.name}`}
        description={
          mode === 'self'
            ? 'Help HR keep accurate records. You can save and come back anytime — submit when you\'re ready.'
            : 'HR view — edit any field on behalf of this staff member, or approve when their submission looks good.'
        }
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={record.status} label={formatStatusLabel(record.status)} />
            {submittedDate ? (
              <span className="text-xs text-app-fg-muted">Submitted {submittedDate}</span>
            ) : null}
            {approvedDate ? (
              <span className="text-xs text-app-fg-muted">Approved {approvedDate}</span>
            ) : null}
          </div>
        }
      />

      {readOnly ? (
        <div className="rounded-lg border border-app-border bg-app-hover/50 p-3 text-sm text-app-fg-muted">
          {record.status === 'APPROVED'
            ? 'Your onboarding has been approved by HR and is now locked. Contact HR if anything needs to change.'
            : 'Your onboarding has been submitted and is waiting for HR review. The form is locked until they approve it.'}
          {approverName && record.status === 'APPROVED' ? (
            <span className="ml-1">Approved by {approverName}.</span>
          ) : null}
        </div>
      ) : null}

      <Form
        method="post"
        action={actionUrl}
        onSubmit={(e) => {
          // We always submit via fetcher so the toast wires up; the underlying
          // <Form> just keeps default native validation behaviour for required fields.
          e.preventDefault();
          handleSaveDraft(e.currentTarget);
        }}
        className="space-y-4"
      >
        <input type="hidden" name="intent" value="updateOnboarding" />

        {/* ── Personal details ───────────────────────────── */}
        <Card>
          <CardHeader title="Personal details" description="The basics HR needs on file." />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Gender">
              <FormSelect
                name="gender"
                defaultValue={record.gender ?? ''}
                disabled={readOnly}
                options={GENDER_OPTIONS}
              />
            </FormField>
            <FormField label="Date of birth">
              <TextInput
                type="date"
                name="dateOfBirth"
                defaultValue={record.dateOfBirth ?? ''}
                disabled={readOnly}
                max={new Date().toISOString().slice(0, 10)}
              />
            </FormField>
            <FormField label="Residential address" className="sm:col-span-2">
              <Textarea
                name="residentialAddress"
                rows={2}
                defaultValue={record.residentialAddress ?? ''}
                disabled={readOnly}
                placeholder="Street, area, city, state"
              />
            </FormField>
            <FormField label="Proof of address" hint="Utility bill or bank statement (PDF / image, ≤10MB)" className="sm:col-span-2">
              {readOnly ? (
                proofUrl ? (
                  <a
                    href={proofUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-brand-500 hover:text-brand-600"
                  >
                    View uploaded file
                  </a>
                ) : (
                  <p className="text-sm text-app-fg-muted">No file uploaded.</p>
                )
              ) : (
                <FileUpload
                  folder={S3_FOLDERS.ONBOARDING_DOCS}
                  accept="application/pdf,image/*"
                  maxSizeMB={10}
                  onUpload={setProofUrl}
                />
              )}
              {!readOnly && proofUrl ? (
                <p className="mt-1 text-xs text-app-fg-muted break-all">Uploaded: {proofUrl}</p>
              ) : null}
            </FormField>
          </CardBody>
        </Card>

        {/* ── Supporting documents ────────────────────────── */}
        <Card>
          <CardHeader
            title="Supporting documents"
            description="Anything else HR should keep on file (NIN, NYSC, certificates)."
          />
          <CardBody className="space-y-3">
            {supportingDocs.length === 0 ? (
              <p className="text-sm text-app-fg-muted">No documents attached yet.</p>
            ) : (
              <ul className="space-y-2">
                {supportingDocs.map((doc, idx) => (
                  <li
                    key={`${doc.url}-${idx}`}
                    className="flex items-center justify-between rounded-md border border-app-border bg-app-elevated px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-app-fg">{doc.label || 'Untitled document'}</p>
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-xs text-brand-500 hover:text-brand-600 break-all"
                      >
                        {doc.url}
                      </a>
                    </div>
                    {!readOnly ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setSupportingDocs((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {!readOnly ? (
              <AddSupportingDocument
                onAdd={(doc) => setSupportingDocs((prev) => [...prev, doc])}
                disabled={supportingDocs.length >= 20}
              />
            ) : null}
          </CardBody>
        </Card>

        {/* ── Guarantors ──────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <GuarantorCard
            index={1}
            record={record}
            readOnly={readOnly}
            letterUrl={g1Letter}
            onLetterUpload={setG1Letter}
          />
          <GuarantorCard
            index={2}
            record={record}
            readOnly={readOnly}
            letterUrl={g2Letter}
            onLetterUpload={setG2Letter}
          />
        </div>

        {/* ── Footer actions ──────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!readOnly ? (
            <Button type="submit" variant="secondary" loading={isSavingDraft || navigation.state === 'submitting'}>
              Save draft
            </Button>
          ) : null}
          {mode === 'self' && record.status === 'IN_PROGRESS' ? (
            <Button
              type="button"
              variant="primary"
              loading={isSubmitting}
              onClick={() => setConfirmSubmit(true)}
            >
              Submit for HR review
            </Button>
          ) : null}
          {mode === 'hr' && record.status === 'SUBMITTED' ? (
            <Button
              type="button"
              variant="primary"
              loading={isApproving}
              onClick={() => setConfirmApprove(true)}
            >
              Approve onboarding
            </Button>
          ) : null}
        </div>

        {fetcher.data?.error ? (
          <p className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-900/30 dark:text-danger-200">
            {fetcher.data.error}
          </p>
        ) : null}
      </Form>

      <ConfirmActionModal
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        title="Submit your onboarding?"
        description="Once submitted, the form locks until HR reviews it. You can ask HR to make changes if anything needs editing afterwards."
        confirmLabel="Submit for review"
        variant="warning"
        loading={isSubmitting}
        onConfirm={() => {
          const fd = new FormData();
          fd.set('intent', 'submitOnboarding');
          fetcher.submit(fd, { method: 'post', action: actionUrl });
          setConfirmSubmit(false);
        }}
      />

      <ConfirmActionModal
        open={confirmApprove}
        onClose={() => setConfirmApprove(false)}
        title="Approve this onboarding?"
        description="The staff member will be notified, and the form will be permanently locked for them. You can still edit on their behalf."
        confirmLabel="Approve"
        variant="warning"
        loading={isApproving}
        onConfirm={() => {
          const fd = new FormData();
          fd.set('intent', 'approveOnboarding');
          fd.set('userId', subject.id);
          fetcher.submit(fd, { method: 'post', action: actionUrl });
          setConfirmApprove(false);
        }}
      />
    </div>
  );
}

function AddSupportingDocument({
  onAdd,
  disabled,
}: {
  onAdd: (doc: { label: string; url: string }) => void;
  disabled: boolean;
}) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const ready = label.trim().length > 0 && url.trim().length > 0;

  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-app-border bg-app-hover/40 p-3 sm:grid-cols-[2fr,3fr,auto] sm:items-end">
      <FormField label="Label">
        <TextInput
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. NIN slip, NYSC certificate"
          maxLength={120}
          disabled={disabled}
        />
      </FormField>
      <FormField label="File">
        {url ? (
          <p className="rounded-md border border-app-border bg-app-elevated px-2 py-1.5 text-xs text-app-fg-muted break-all">{url}</p>
        ) : (
          <FileUpload
            folder={S3_FOLDERS.ONBOARDING_DOCS}
            accept="application/pdf,image/*"
            maxSizeMB={10}
            onUpload={setUrl}
            size="sm"
          />
        )}
      </FormField>
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={!ready || disabled}
        onClick={() => {
          if (!ready) return;
          onAdd({ label: label.trim(), url: url.trim() });
          setLabel('');
          setUrl('');
        }}
      >
        Add document
      </Button>
    </div>
  );
}

function GuarantorCard({
  index,
  record,
  readOnly,
  letterUrl,
  onLetterUpload,
}: {
  index: 1 | 2;
  record: OnboardingRecord;
  readOnly: boolean;
  letterUrl: string;
  onLetterUpload: (url: string) => void;
}) {
  const prefix = `guarantor${index}` as const;
  const data = {
    name: record[`${prefix}Name` as const] ?? '',
    phone: record[`${prefix}Phone` as const] ?? '',
    email: record[`${prefix}Email` as const] ?? '',
    address: record[`${prefix}Address` as const] ?? '',
    relationship: record[`${prefix}Relationship` as const] ?? '',
  };

  return (
    <Card>
      <CardHeader title={`Guarantor ${index}`} description="Mandatory at submission. Two guarantors required." />
      <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Full name">
          <TextInput name={`${prefix}Name`} defaultValue={data.name} disabled={readOnly} maxLength={120} />
        </FormField>
        <FormField label="Phone">
          <TextInput name={`${prefix}Phone`} defaultValue={data.phone} disabled={readOnly} maxLength={40} />
        </FormField>
        <FormField label="Email">
          <TextInput type="email" name={`${prefix}Email`} defaultValue={data.email} disabled={readOnly} maxLength={120} />
        </FormField>
        <FormField label="Relationship">
          <TextInput
            name={`${prefix}Relationship`}
            defaultValue={data.relationship}
            disabled={readOnly}
            maxLength={80}
            placeholder="e.g. Uncle, former employer"
          />
        </FormField>
        <FormField label="Address" className="sm:col-span-2">
          <Textarea name={`${prefix}Address`} rows={2} defaultValue={data.address} disabled={readOnly} />
        </FormField>
        <FormField label="Signed letter" hint="PDF or image, ≤10MB" className="sm:col-span-2">
          {readOnly ? (
            letterUrl ? (
              <a
                href={letterUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-brand-500 hover:text-brand-600"
              >
                View uploaded letter
              </a>
            ) : (
              <p className="text-sm text-app-fg-muted">No letter uploaded.</p>
            )
          ) : (
            <FileUpload
              folder={S3_FOLDERS.ONBOARDING_DOCS}
              accept="application/pdf,image/*"
              maxSizeMB={10}
              onUpload={onLetterUpload}
            />
          )}
          {!readOnly && letterUrl ? (
            <p className="mt-1 text-xs text-app-fg-muted break-all">Uploaded: {letterUrl}</p>
          ) : null}
        </FormField>
      </CardBody>
    </Card>
  );
}
