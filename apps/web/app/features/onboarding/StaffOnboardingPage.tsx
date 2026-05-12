import { useState, useMemo } from 'react';
import { Form, useFetcher, useNavigation } from '@remix-run/react';
import { Breadcrumb } from '~/components/ui/breadcrumb';
import { Button } from '~/components/ui/button';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { DescriptionList } from '~/components/ui/description-list';
import { FormField } from '~/components/ui/form-field';
import { FormSelect } from '~/components/ui/form-select';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { StatusBadge } from '~/components/ui/status-badge';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Modal } from '~/components/ui/modal';
import { FileUpload } from '~/components/ui/file-upload';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';

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
  payoutBankName: string | null;
  payoutAccountName: string | null;
  payoutAccountNumber: string | null;
  payoutBankCode: string | null;
  changesRequestedAt: string | null;
  changesRequestedBy: string | null;
  changesRequestedReason: string | null;
}

export interface StaffOnboardingPageProps {
  /** Subject of the page — the staff member whose onboarding is being viewed/edited. */
  subject: { id: string; name: string; role?: string };
  /** Current onboarding record (synthetic NOT_STARTED placeholder when no row yet). */
  record: OnboardingRecord;
  /**
   * `self`  — the actor IS the subject. Form follows lock rules (SUBMITTED/APPROVED → read-only).
   * `hr`    — HR / admin viewing a staff member. Fields are read-only; staff edit on `/admin/onboarding`. Approve when SUBMITTED.
   */
  mode: 'self' | 'hr';
  /** Action endpoint — defaults to current route. */
  actionUrl?: string;
  /** When true, show breadcrumb back to /hr/users/:id. */
  showBackToProfile?: boolean;
  approverName?: string | null;
  /**
   * Set when the actor is browsing the app via Mirror Mode. Forces every form field
   * + every action button into read-only state so the admin can't write into the
   * mirrored user's onboarding (S3 uploads, draft saves, submit, approve all blocked).
   * The server still gates these via `blockMutationsWhileMirroring` + the `/api/upload-url`
   * mirror check — this prop is the UX layer that disables the affordance up-front.
   */
  isMirroring?: boolean;
}

/**
 * HR Manager / SuperAdmin / Admin can't review their own onboarding — SuperAdmin handles
 * those roles' approvals. The reviewer copy in the "self" submitted/approved banners
 * branches off this so the message stays accurate per role.
 */
function reviewerLabel(subjectRole: string | undefined): string {
  if (
    subjectRole === 'HR_MANAGER' ||
    subjectRole === 'SUPER_ADMIN' ||
    subjectRole === 'ADMIN'
  ) {
    return 'a Super Admin';
  }
  return 'HR';
}

const GENDER_OPTIONS = [
  { value: '', label: 'Select…' },
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' }
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

function formatGenderLabel(gender: OnboardingRecord['gender']): string {
  if (!gender) return '';
  const row = GENDER_OPTIONS.find((o) => o.value === gender);
  return row?.label ?? gender;
}

function formatDobDisplay(isoDate: string | null): string {
  if (!isoDate) return '';
  const d = new Date(isoDate.includes('T') ? isoDate : `${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-NG', { dateStyle: 'long' });
}

function DocumentOpenLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex w-fit items-center rounded-md border border-app-border bg-app-elevated px-3 py-2 text-sm font-medium text-brand-600 shadow-sm transition-colors hover:border-brand-400/40 hover:bg-app-hover dark:text-brand-400"
    >
      {label}
      <span className="ml-1.5 text-xs font-normal text-app-fg-muted">↗</span>
    </a>
  );
}

function OnboardingReadOnlyView({ record }: { record: OnboardingRecord }) {
  const genderDisplay = formatGenderLabel(record.gender);
  const dobDisplay = formatDobDisplay(record.dateOfBirth);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Personal details" description="Information on file from the staff member." />
        <CardBody>
          <DescriptionList
            layout="grid"
            divided
            items={[
              {
                label: 'Gender',
                value: genderDisplay || <span className="text-app-fg-muted">Not provided</span>,
              },
              {
                label: 'Date of birth',
                value: dobDisplay || <span className="text-app-fg-muted">Not provided</span>,
              },
              {
                label: 'Residential address',
                value: record.residentialAddress?.trim() ? (
                  <span className="whitespace-pre-wrap">{record.residentialAddress}</span>
                ) : (
                  <span className="text-app-fg-muted">Not provided</span>
                ),
                fullWidth: true,
              },
              {
                label: 'Proof of address',
                value: record.proofOfAddressUrl ? (
                  <DocumentOpenLink href={record.proofOfAddressUrl} label="Open proof of address" />
                ) : (
                  <span className="text-app-fg-muted">Not provided</span>
                ),
                fullWidth: true,
              },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Supporting documents"
          description="Additional documents supplied with onboarding."
        />
        <CardBody className="space-y-2">
          {record.supportingDocuments.length === 0 ? (
            <p className="text-sm text-app-fg-muted">No supporting documents attached.</p>
          ) : (
            <ul className="space-y-2">
              {record.supportingDocuments.map((doc, idx) => (
                <li
                  key={`${doc.url}-${idx}`}
                  className="flex flex-col gap-2 rounded-lg border border-app-border bg-app-elevated/80 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-app-fg">{doc.label?.trim() || 'Untitled document'}</p>
                  </div>
                  <DocumentOpenLink href={doc.url} label="Open file" />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GuarantorReadOnlyCard index={1} record={record} />
        <GuarantorReadOnlyCard index={2} record={record} />
      </div>

      <BankDetailsReadOnlyCard record={record} />
    </div>
  );
}

function BankDetailsReadOnlyCard({ record }: { record: OnboardingRecord }) {
  const empty = <span className="text-app-fg-muted">Not provided</span>;
  return (
    <Card>
      <CardHeader
        title="Payout bank details"
        description="Used by Finance to process monthly payroll. Visible only to Finance and HR."
      />
      <CardBody>
        <DescriptionList
          layout="grid"
          divided
          items={[
            { label: 'Bank name', value: record.payoutBankName?.trim() ? record.payoutBankName : empty },
            { label: 'Account name', value: record.payoutAccountName?.trim() ? record.payoutAccountName : empty },
            {
              label: 'Account number',
              value: record.payoutAccountNumber?.trim() ? (
                <span className="tabular-nums">{record.payoutAccountNumber}</span>
              ) : (
                empty
              ),
            },
            {
              label: 'Bank code',
              value: record.payoutBankCode?.trim() ? (
                <span className="tabular-nums">{record.payoutBankCode}</span>
              ) : (
                empty
              ),
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}

function GuarantorReadOnlyCard({ index, record }: { index: 1 | 2; record: OnboardingRecord }) {
  const prefix = `guarantor${index}` as const;
  const letterUrl = record[`${prefix}LetterUrl` as const];
  const name = record[`${prefix}Name` as const];
  const phone = record[`${prefix}Phone` as const];
  const email = record[`${prefix}Email` as const];
  const relationship = record[`${prefix}Relationship` as const];
  const address = record[`${prefix}Address` as const];

  const empty = <span className="text-app-fg-muted">Not provided</span>;

  return (
    <Card>
      <CardHeader title={`Guarantor ${index}`} description="Reference and signed letter on file." />
      <CardBody>
        <DescriptionList
          layout="grid"
          divided
          items={[
            { label: 'Full name', value: name?.trim() ? name : empty },
            { label: 'Phone', value: phone?.trim() ? phone : empty },
            { label: 'Email', value: email?.trim() ? email : empty },
            { label: 'Relationship', value: relationship?.trim() ? relationship : empty },
            {
              label: 'Address',
              value: address?.trim() ? <span className="whitespace-pre-wrap">{address}</span> : empty,
              fullWidth: true,
            },
            {
              label: 'Signed letter',
              value: letterUrl ? (
                <DocumentOpenLink href={letterUrl} label="Open signed letter" />
              ) : (
                empty
              ),
              fullWidth: true,
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}

export function StaffOnboardingPage({
  subject,
  record,
  mode,
  actionUrl,
  showBackToProfile,
  approverName,
  isMirroring = false,
}: StaffOnboardingPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const navigation = useNavigation();

  useFetcherToast(fetcher.data, { successMessage: 'Onboarding saved' });

  // Lock rules: staff lose write access once SUBMITTED or APPROVED. HR profile view is always
  // read-only for fields. Mirror Mode is also strictly view-only — see CLAUDE.md → "Mirror Mode".
  const lockedForStaff = record.status === 'SUBMITTED' || record.status === 'APPROVED';
  const readOnly = (mode === 'self' && lockedForStaff) || mode === 'hr' || isMirroring;

  const [proofUrl, setProofUrl] = useState(record.proofOfAddressUrl ?? '');
  const [g1Letter, setG1Letter] = useState(record.guarantor1LetterUrl ?? '');
  const [g2Letter, setG2Letter] = useState(record.guarantor2LetterUrl ?? '');
  const [supportingDocs, setSupportingDocs] = useState(record.supportingDocuments);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const [requestChangesReason, setRequestChangesReason] = useState('');

  // Close confirm modals only AFTER the action returns success — keeps the
  // user on the spinner until the request actually resolves so they know
  // whether it went through.
  useCloseOnFetcherSuccess(fetcher, () => {
    setConfirmSubmit(false);
    setConfirmApprove(false);
    setRequestChangesOpen(false);
    setRequestChangesReason('');
  });

  const isSavingDraft =
    fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'updateOnboarding';
  const isSubmitting =
    fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'submitOnboarding';
  const isApproving =
    fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'approveOnboarding';
  const isRequestingChanges =
    fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'requestOnboardingChanges';
  const trimmedReason = requestChangesReason.trim();
  const reasonReady = trimmedReason.length >= 10 && trimmedReason.length <= 1000;

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
            : 'Review the documents below and approve when ready.'
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
            <PageRefreshButton />
          </div>
        }
      />

      {isMirroring ? (
        <div className="rounded-lg border border-success-300 bg-success-50 p-3 text-sm text-success-900 dark:border-success-700 dark:bg-success-900/20 dark:text-success-100">
          <p className="font-semibold">Read-only — Mirror Mode</p>
          <p className="mt-1">
            You're viewing this onboarding as {subject.name}. Form fields, file uploads,
            save and submit are disabled. Exit Mirror Mode from the header to make changes
            on your own account.
          </p>
        </div>
      ) : null}

      {readOnly && mode === 'self' && !isMirroring ? (
        <div className="rounded-lg border border-app-border bg-app-hover/50 p-3 text-sm text-app-fg-muted">
          {record.status === 'APPROVED'
            ? `Your onboarding has been approved by ${reviewerLabel(subject.role)} and is now locked. Contact ${reviewerLabel(subject.role)} if anything needs to change.`
            : `Your onboarding has been submitted and is waiting for review by ${reviewerLabel(subject.role)}. The form is locked until it's approved.`}
          {approverName && record.status === 'APPROVED' ? (
            <span className="ml-1">Approved by {approverName}.</span>
          ) : null}
        </div>
      ) : null}

      {mode === 'self' && !readOnly && record.changesRequestedReason ? (
        <div className="rounded-lg border border-warning-300 bg-warning-50 p-3 text-sm text-warning-900 dark:border-warning-700 dark:bg-warning-900/30 dark:text-warning-100">
          <p className="font-semibold">{reviewerLabel(subject.role)} requested changes</p>
          <p className="mt-1 whitespace-pre-wrap">{record.changesRequestedReason}</p>
          <p className="mt-1 text-xs text-warning-800/80 dark:text-warning-100/70">
            Update the relevant sections below and re-submit when ready.
          </p>
        </div>
      ) : null}

      {mode === 'hr' && record.status === 'IN_PROGRESS' && record.changesRequestedReason ? (
        <div className="rounded-lg border border-warning-300 bg-warning-50 p-3 text-sm text-warning-900 dark:border-warning-700 dark:bg-warning-900/30 dark:text-warning-100">
          <p className="font-semibold">Sent back for changes</p>
          <p className="mt-1 whitespace-pre-wrap">{record.changesRequestedReason}</p>
          <p className="mt-1 text-xs text-warning-800/80 dark:text-warning-100/70">
            Waiting for the staff member to update and re-submit.
          </p>
        </div>
      ) : null}
      {readOnly ? (
        <div className="space-y-4">
          <OnboardingReadOnlyView record={record} />

          <div className="flex flex-wrap items-center justify-end gap-2">
            {mode === 'hr' && record.status === 'SUBMITTED' && !isMirroring ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  loading={isRequestingChanges}
                  onClick={() => setRequestChangesOpen(true)}
                >
                  Request changes
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  loading={isApproving}
                  onClick={() => setConfirmApprove(true)}
                >
                  Approve onboarding
                </Button>
              </>
            ) : null}
          </div>

          {fetcher.data?.error ? (
            <p className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-900/30 dark:text-danger-200">
              {fetcher.data.error}
            </p>
          ) : null}
        </div>
      ) : (
        <Form
          method="post"
          action={actionUrl}
          onSubmit={(e) => {
            e.preventDefault();
            handleSaveDraft(e.currentTarget);
          }}
          className="space-y-4"
        >
          <input type="hidden" name="intent" value="updateOnboarding" />

          <Card>
            <CardHeader title="Personal details" description="The basics HR needs on file." />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Gender">
                <FormSelect name="gender" defaultValue={record.gender ?? ''} options={GENDER_OPTIONS} />
              </FormField>
              <FormField label="Date of birth">
                <TextInput
                  type="date"
                  name="dateOfBirth"
                  defaultValue={record.dateOfBirth ?? ''}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </FormField>
              <FormField label="Residential address" className="sm:col-span-2">
                <Textarea
                  name="residentialAddress"
                  rows={2}
                  defaultValue={record.residentialAddress ?? ''}
                  placeholder="Street, area, city, state"
                />
              </FormField>
              <FormField label="Proof of address" hint="Utility bill or bank statement (PDF / image, ≤10MB)" className="sm:col-span-2">
                <FileUpload
                  folder={S3_FOLDERS.ONBOARDING_DOCS}
                  accept="application/pdf,image/*"
                  maxSizeMB={10}
                  onUpload={setProofUrl}
                />
                {proofUrl ? (
                  <p className="mt-1 text-xs text-app-fg-muted break-all">Uploaded: {proofUrl}</p>
                ) : null}
              </FormField>
            </CardBody>
          </Card>

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
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSupportingDocs((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <AddSupportingDocument
                onAdd={(doc) => setSupportingDocs((prev) => [...prev, doc])}
                disabled={supportingDocs.length >= 20}
              />
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <GuarantorCard
              index={1}
              record={record}
              readOnly={false}
              letterUrl={g1Letter}
              onLetterUpload={setG1Letter}
            />
            <GuarantorCard
              index={2}
              record={record}
              readOnly={false}
              letterUrl={g2Letter}
              onLetterUpload={setG2Letter}
            />
          </div>

          <Card>
            <CardHeader
              title="Payout bank details"
              description="Where Finance sends your payroll. Required before review."
            />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Bank name" hint="e.g. GTBank, Access Bank, OPay">
                <TextInput
                  name="payoutBankName"
                  defaultValue={record.payoutBankName ?? ''}
                  maxLength={120}
                />
              </FormField>
              <FormField label="Account name" hint="As it appears on your bank statement">
                <TextInput
                  name="payoutAccountName"
                  defaultValue={record.payoutAccountName ?? ''}
                  maxLength={120}
                />
              </FormField>
              <FormField label="Account number" hint="10-digit NUBAN">
                <TextInput
                  name="payoutAccountNumber"
                  defaultValue={record.payoutAccountNumber ?? ''}
                  maxLength={20}
                  inputMode="numeric"
                  pattern="[0-9]*"
                />
              </FormField>
              <FormField label="Bank code" hint="Optional — 3-digit CBN code (e.g. 058 for GTBank)">
                <TextInput
                  name="payoutBankCode"
                  defaultValue={record.payoutBankCode ?? ''}
                  maxLength={20}
                  inputMode="numeric"
                />
              </FormField>
            </CardBody>
          </Card>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="submit" variant="secondary" loading={isSavingDraft || navigation.state === 'submitting'}>
              Save draft
            </Button>
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
          </div>

          {fetcher.data?.error ? (
            <p className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-900/30 dark:text-danger-200">
              {fetcher.data.error}
            </p>
          ) : null}
        </Form>
      )}

      <ConfirmActionModal
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        title="Submit your onboarding?"
        description="After submission, the form stays locked until HR reviews it."
        confirmLabel="Submit for review"
        variant="warning"
        loading={isSubmitting}
        onConfirm={() => {
          const fd = new FormData();
          fd.set('intent', 'submitOnboarding');
          fetcher.submit(fd, { method: 'post', action: actionUrl });
        }}
      />

      <ConfirmActionModal
        open={confirmApprove}
        onClose={() => setConfirmApprove(false)}
        title="Approve this onboarding?"
        description="The staff member will be notified. The record stays locked unless you coordinate a correction."
        confirmLabel="Approve"
        variant="warning"
        loading={isApproving}
        onConfirm={() => {
          const fd = new FormData();
          fd.set('intent', 'approveOnboarding');
          fd.set('userId', subject.id);
          fetcher.submit(fd, { method: 'post', action: actionUrl });
        }}
      />

      <Modal
        open={requestChangesOpen}
        onClose={() => {
          if (isRequestingChanges) return;
          setRequestChangesOpen(false);
          setRequestChangesReason('');
        }}
        aria-labelledby="request-changes-title"
      >
        <div className="space-y-3 p-5">
          <h3 id="request-changes-title" className="text-base font-semibold text-app-fg">
            Request changes
          </h3>
          <p className="text-sm text-app-fg-muted">
            The staff member will be notified and can edit their onboarding again.
            Be specific about what to update so they can fix it on the first round.
          </p>
          <FormField label="What needs changes?" hint="Min 10 characters · sent to the staff member">
            <Textarea
              rows={4}
              value={requestChangesReason}
              onChange={(e) => setRequestChangesReason(e.target.value)}
              placeholder="e.g. Re-upload the proof of address — the current file is unreadable."
              maxLength={1000}
              autoFocus
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setRequestChangesOpen(false);
                setRequestChangesReason('');
              }}
              disabled={isRequestingChanges}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={isRequestingChanges}
              disabled={!reasonReady}
              onClick={() => {
                if (!reasonReady) return;
                const fd = new FormData();
                fd.set('intent', 'requestOnboardingChanges');
                fd.set('userId', subject.id);
                fd.set('reason', trimmedReason);
                fetcher.submit(fd, { method: 'post', action: actionUrl });
              }}
            >
              Send to staff
            </Button>
          </div>
        </div>
      </Modal>
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
    <div className="flex flex-col gap-3 rounded-md border border-app-border bg-app-hover/40 p-3">
      <FormField label="Document label">
        <TextInput
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. NIN slip, NYSC certificate"
          maxLength={120}
          disabled={disabled}
        />
      </FormField>
      <FormField label="File" hint="PDF or image, ≤10MB">
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
      <div className="flex justify-end">
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
