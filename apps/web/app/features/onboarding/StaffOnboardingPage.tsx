import { useState, useMemo } from 'react';
import { Form, useFetcher, useNavigation } from '@remix-run/react';
import { Breadcrumb } from '~/components/ui/breadcrumb';
import { Button } from '~/components/ui/button';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { DescriptionList } from '~/components/ui/description-list';
import { FormField } from '~/components/ui/form-field';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { StatusBadge } from '~/components/ui/status-badge';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Modal } from '~/components/ui/modal';
import { FileUpload } from '~/components/ui/file-upload';
import { ASSET_FOLDERS } from '~/lib/object-storage';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { NIGERIAN_BANKS, NIGERIAN_STATES, findBankByName } from '@yannis/shared';

/** Public FIRS TaxProMax portal where staff can request a Tax Identification Number. */
const TAX_ID_REGISTER_URL = 'https://taxpromax.firs.gov.ng/';

const STATE_OPTIONS = [
  { value: '', label: 'Select…' },
  ...NIGERIAN_STATES.map((s) => ({ value: s, label: s })),
];

const BANK_SELECT_OPTIONS = [
  { value: '', label: 'Select your bank…' },
  ...NIGERIAN_BANKS.map((b) => ({ value: b.name, label: b.name })),
];

type OnboardingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED';

export interface OnboardingRecord {
  userId: string;
  status: OnboardingStatus;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY' | null;
  dateOfBirth: string | null;
  residentialAddress: string | null;
  currentStateOfResidence: string | null;
  proofOfAddressUrl: string | null;
  supportingDocuments: Array<{ label: string; url: string }>;
  /** Identification + contracts (HR feedback 2026-05). */
  signedContractUrl: string | null;
  governmentIdUrl: string | null;
  additionalPhoneNumbers: string | null;
  /** Statutory + financial assistance. */
  taxId: string | null;
  rentReceiptUrl: string | null;
  /** Academic + employment background. */
  academicRecordsUrl: string | null;
  employmentHistoryUrl: string | null;
  /** Guarantor 1 — file-only post HR feedback 2026-05. Legacy text columns
   *  preserved on the type so older records still render. */
  guarantor1Name: string | null;
  guarantor1Phone: string | null;
  guarantor1Email: string | null;
  guarantor1Address: string | null;
  guarantor1Relationship: string | null;
  guarantor1LetterUrl: string | null;
  guarantor1FormUrl: string | null;
  guarantor1IdUrl: string | null;
  /** Guarantor 2. */
  guarantor2Name: string | null;
  guarantor2Phone: string | null;
  guarantor2Email: string | null;
  guarantor2Address: string | null;
  guarantor2Relationship: string | null;
  guarantor2LetterUrl: string | null;
  guarantor2FormUrl: string | null;
  guarantor2IdUrl: string | null;
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
   * mirrored user's onboarding (asset uploads, draft saves, submit, approve all blocked).
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
  const empty = <span className="text-app-fg-muted">Not provided</span>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Personal details" description="Information on file from the staff member." />
        <CardBody>
          <DescriptionList
            layout="grid"
            divided
            items={[
              { label: 'Gender', value: genderDisplay || empty },
              { label: 'Date of birth', value: dobDisplay || empty },
              {
                label: 'Current state of residence',
                value: record.currentStateOfResidence?.trim() ? record.currentStateOfResidence : empty,
              },
              {
                label: 'Residential address',
                value: record.residentialAddress?.trim() ? (
                  <span className="whitespace-pre-wrap">{record.residentialAddress}</span>
                ) : (
                  empty
                ),
                fullWidth: true,
              },
              {
                label: 'Additional phone numbers',
                value: record.additionalPhoneNumbers?.trim() ? record.additionalPhoneNumbers : empty,
                fullWidth: true,
              },
              {
                label: 'Proof of address',
                value: record.proofOfAddressUrl ? (
                  <DocumentOpenLink href={record.proofOfAddressUrl} label="Open proof of address" />
                ) : (
                  empty
                ),
                fullWidth: true,
              },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Identification & contracts"
          description="Signed contract and government-issued ID. Required at submission."
        />
        <CardBody>
          <DescriptionList
            layout="grid"
            divided
            items={[
              {
                label: 'Signed contract',
                value: record.signedContractUrl ? (
                  <DocumentOpenLink href={record.signedContractUrl} label="Open signed contract" />
                ) : (
                  empty
                ),
                fullWidth: true,
              },
              {
                label: 'Government ID (NIN slip or international passport)',
                value: record.governmentIdUrl ? (
                  <DocumentOpenLink href={record.governmentIdUrl} label="Open ID document" />
                ) : (
                  empty
                ),
                fullWidth: true,
              },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Statutory documents"
          description="Tax ID and any rent relief documents for payroll."
        />
        <CardBody>
          <DescriptionList
            layout="grid"
            divided
            items={[
              {
                label: 'Tax ID (TIN)',
                value: record.taxId?.trim() ? (
                  <span className="tabular-nums">{record.taxId}</span>
                ) : (
                  empty
                ),
              },
              {
                label: 'Rent receipt',
                value: record.rentReceiptUrl ? (
                  <DocumentOpenLink href={record.rentReceiptUrl} label="Open rent receipt" />
                ) : (
                  empty
                ),
              },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Academic & employment background"
          description="Records covering the applicant's education and prior employment."
        />
        <CardBody>
          <DescriptionList
            layout="grid"
            divided
            items={[
              {
                label: 'Academic records',
                value: record.academicRecordsUrl ? (
                  <DocumentOpenLink href={record.academicRecordsUrl} label="Open academic records" />
                ) : (
                  empty
                ),
                fullWidth: true,
              },
              {
                label: 'Employment history',
                value: record.employmentHistoryUrl ? (
                  <DocumentOpenLink href={record.employmentHistoryUrl} label="Open employment history" />
                ) : (
                  empty
                ),
                fullWidth: true,
              },
            ]}
          />
        </CardBody>
      </Card>

      {record.supportingDocuments.length > 0 ? (
        <Card>
          <CardHeader
            title="Other supporting documents"
            description="Extras outside the standard checklist."
          />
          <CardBody className="space-y-2">
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
          </CardBody>
        </Card>
      ) : null}

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
  const formUrl = record[`${prefix}FormUrl` as const];
  const idUrl = record[`${prefix}IdUrl` as const];
  // Legacy fields kept visible only when present so older records still display
  // the original reference text. New onboardings skip them entirely.
  const legacyName = record[`${prefix}Name` as const];
  const legacyPhone = record[`${prefix}Phone` as const];
  const legacyLetter = record[`${prefix}LetterUrl` as const];
  const hasLegacy = !!(legacyName?.trim() || legacyPhone?.trim() || legacyLetter?.trim());

  const empty = <span className="text-app-fg-muted">Not provided</span>;

  return (
    <Card>
      <CardHeader title={`Guarantor ${index}`} description="Signed guarantor form and means of ID on file." />
      <CardBody>
        <DescriptionList
          layout="grid"
          divided
          items={[
            {
              label: 'Guarantor form',
              value: formUrl ? (
                <DocumentOpenLink href={formUrl} label="Open signed guarantor form" />
              ) : (
                empty
              ),
              fullWidth: true,
            },
            {
              label: 'Means of ID',
              value: idUrl ? (
                <DocumentOpenLink href={idUrl} label="Open means of ID" />
              ) : (
                empty
              ),
              fullWidth: true,
            },
            ...(hasLegacy
              ? [
                  {
                    label: 'Legacy reference (pre HR feedback 2026-05)',
                    value: (
                      <div className="space-y-1 text-sm">
                        {legacyName?.trim() ? <p>{legacyName}</p> : null}
                        {legacyPhone?.trim() ? <p className="text-app-fg-muted">{legacyPhone}</p> : null}
                        {legacyLetter?.trim() ? (
                          <DocumentOpenLink href={legacyLetter} label="Open legacy signed letter" />
                        ) : null}
                      </div>
                    ),
                    fullWidth: true,
                  },
                ]
              : []),
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
  const [signedContractUrl, setSignedContractUrl] = useState(record.signedContractUrl ?? '');
  const [governmentIdUrl, setGovernmentIdUrl] = useState(record.governmentIdUrl ?? '');
  const [rentReceiptUrl, setRentReceiptUrl] = useState(record.rentReceiptUrl ?? '');
  const [academicRecordsUrl, setAcademicRecordsUrl] = useState(record.academicRecordsUrl ?? '');
  const [employmentHistoryUrl, setEmploymentHistoryUrl] = useState(record.employmentHistoryUrl ?? '');
  const [g1Form, setG1Form] = useState(record.guarantor1FormUrl ?? '');
  const [g1IdDoc, setG1IdDoc] = useState(record.guarantor1IdUrl ?? '');
  const [g2Form, setG2Form] = useState(record.guarantor2FormUrl ?? '');
  const [g2IdDoc, setG2IdDoc] = useState(record.guarantor2IdUrl ?? '');
  const [supportingDocs, setSupportingDocs] = useState(record.supportingDocuments);
  // Bank picker — track the name so we can auto-fill the matching code when
  // the user picks from the dropdown. Free-text legacy values (not in the
  // list) stay editable via the same input.
  const [bankName, setBankName] = useState(record.payoutBankName ?? '');
  const [bankCode, setBankCode] = useState(record.payoutBankCode ?? '');
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const [requestChangesReason, setRequestChangesReason] = useState('');

  const handleBankChange = (nextName: string) => {
    setBankName(nextName);
    const match = findBankByName(nextName);
    // Auto-fill the code from the canonical list. If staff picked a bank
    // that's not in NIGERIAN_BANKS (legacy free text), leave whatever code
    // they already had so we don't blow it away.
    if (match) setBankCode(match.code);
  };

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
    fd.set('signedContractUrl', signedContractUrl);
    fd.set('governmentIdUrl', governmentIdUrl);
    fd.set('rentReceiptUrl', rentReceiptUrl);
    fd.set('academicRecordsUrl', academicRecordsUrl);
    fd.set('employmentHistoryUrl', employmentHistoryUrl);
    fd.set('guarantor1FormUrl', g1Form);
    fd.set('guarantor1IdUrl', g1IdDoc);
    fd.set('guarantor2FormUrl', g2Form);
    fd.set('guarantor2IdUrl', g2IdDoc);
    fd.set('supportingDocuments', JSON.stringify(supportingDocs));
    // Bank picker — push the controlled values so the bank-name code pair
    // stays in sync (matching the NIGERIAN_BANKS auto-fill above).
    fd.set('payoutBankName', bankName);
    fd.set('payoutBankCode', bankCode);
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
              <FormField label="Current state of residence">
                <FormSelect
                  name="currentStateOfResidence"
                  defaultValue={record.currentStateOfResidence ?? ''}
                  options={STATE_OPTIONS}
                />
              </FormField>
              <FormField label="Additional phone numbers" hint="Optional — separate with commas">
                <TextInput
                  name="additionalPhoneNumbers"
                  defaultValue={record.additionalPhoneNumbers ?? ''}
                  maxLength={500}
                  placeholder="e.g. 0803… , 0810…"
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
                  folder={ASSET_FOLDERS.ONBOARDING_DOCS}
                  accept="application/pdf,image/*"
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
              title="Identification & contracts"
              description="Signed contract and a government-issued ID. Both required at submission."
            />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Signed contract" hint="PDF or image, ≤10MB" className="sm:col-span-2">
                <FileUpload
                  folder={ASSET_FOLDERS.ONBOARDING_DOCS}
                  accept="application/pdf,image/*"
                  onUpload={setSignedContractUrl}
                />
                {signedContractUrl ? (
                  <p className="mt-1 text-xs text-app-fg-muted break-all">Uploaded: {signedContractUrl}</p>
                ) : null}
              </FormField>
              <FormField
                label="Government ID"
                hint="NIN slip OR international passport (PDF / image, ≤10MB)"
                className="sm:col-span-2"
              >
                <FileUpload
                  folder={ASSET_FOLDERS.ONBOARDING_DOCS}
                  accept="application/pdf,image/*"
                  onUpload={setGovernmentIdUrl}
                />
                {governmentIdUrl ? (
                  <p className="mt-1 text-xs text-app-fg-muted break-all">Uploaded: {governmentIdUrl}</p>
                ) : null}
              </FormField>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Statutory documents"
              description="Tax ID for payroll, and a rent receipt if you'd like to claim rent relief."
            />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="Tax ID (TIN)"
                hint={
                  <>
                    Don't have one yet?{' '}
                    <a
                      href={TAX_ID_REGISTER_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      Register on FIRS TaxProMax →
                    </a>
                  </>
                }
              >
                <TextInput
                  name="taxId"
                  defaultValue={record.taxId ?? ''}
                  maxLength={60}
                  inputMode="numeric"
                />
              </FormField>
              <FormField label="Rent receipt" hint="Optional — PDF or image, ≤10MB">
                <FileUpload
                  folder={ASSET_FOLDERS.ONBOARDING_DOCS}
                  accept="application/pdf,image/*"
                  onUpload={setRentReceiptUrl}
                />
                {rentReceiptUrl ? (
                  <p className="mt-1 text-xs text-app-fg-muted break-all">Uploaded: {rentReceiptUrl}</p>
                ) : null}
              </FormField>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Academic & employment background"
              description="Attach one combined PDF per row — certificates, transcripts, CV, prior employment letters."
            />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Academic records" hint="PDF or image, ≤10MB">
                <FileUpload
                  folder={ASSET_FOLDERS.ONBOARDING_DOCS}
                  accept="application/pdf,image/*"
                  onUpload={setAcademicRecordsUrl}
                />
                {academicRecordsUrl ? (
                  <p className="mt-1 text-xs text-app-fg-muted break-all">Uploaded: {academicRecordsUrl}</p>
                ) : null}
              </FormField>
              <FormField label="Employment history" hint="PDF or image, ≤10MB">
                <FileUpload
                  folder={ASSET_FOLDERS.ONBOARDING_DOCS}
                  accept="application/pdf,image/*"
                  onUpload={setEmploymentHistoryUrl}
                />
                {employmentHistoryUrl ? (
                  <p className="mt-1 text-xs text-app-fg-muted break-all">Uploaded: {employmentHistoryUrl}</p>
                ) : null}
              </FormField>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Other supporting documents"
              description="Optional — anything outside the standard checklist HR should keep on file."
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
              formUrl={g1Form}
              idUrl={g1IdDoc}
              onFormUpload={setG1Form}
              onIdUpload={setG1IdDoc}
            />
            <GuarantorCard
              index={2}
              formUrl={g2Form}
              idUrl={g2IdDoc}
              onFormUpload={setG2Form}
              onIdUpload={setG2IdDoc}
            />
          </div>

          <Card>
            <CardHeader
              title="Payout bank details"
              description="Where Finance sends your payroll. Required before review."
            />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Bank" hint="Pick from the list — bank code fills in automatically">
                <SearchableSelect
                  id="onboarding-bank-name"
                  value={bankName}
                  onChange={handleBankChange}
                  options={BANK_SELECT_OPTIONS}
                  placeholder="Select your bank…"
                  searchPlaceholder="Search banks…"
                  wrapperClassName="w-full"
                />
                {/* Hidden inputs so the controlled bank name + code reach the
                    server even though the visible control is SearchableSelect. */}
                <input type="hidden" name="payoutBankName" value={bankName} />
                <input type="hidden" name="payoutBankCode" value={bankCode} />
              </FormField>
              <FormField
                label="Bank code"
                hint={bankCode ? `Auto-filled from ${bankName || 'selected bank'}` : '3-digit CBN code'}
              >
                <TextInput value={bankCode} disabled readOnly placeholder="—" />
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
            folder={ASSET_FOLDERS.ONBOARDING_DOCS}
            accept="application/pdf,image/*"
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
  formUrl,
  idUrl,
  onFormUpload,
  onIdUpload,
}: {
  index: 1 | 2;
  formUrl: string;
  idUrl: string;
  onFormUpload: (url: string) => void;
  onIdUpload: (url: string) => void;
}) {
  return (
    <Card>
      <CardHeader
        title={`Guarantor ${index}`}
        description="Upload the signed guarantor form and a means of ID. Both files required at submission."
      />
      <CardBody className="grid grid-cols-1 gap-4">
        <FormField label="Signed guarantor form" hint="PDF or image, ≤10MB">
          <FileUpload
            folder={ASSET_FOLDERS.ONBOARDING_DOCS}
            accept="application/pdf,image/*"
            onUpload={onFormUpload}
          />
          {formUrl ? (
            <p className="mt-1 text-xs text-app-fg-muted break-all">Uploaded: {formUrl}</p>
          ) : null}
        </FormField>
        <FormField label="Means of ID" hint="NIN slip / passport / driver's licence (PDF / image, ≤10MB)">
          <FileUpload
            folder={ASSET_FOLDERS.ONBOARDING_DOCS}
            accept="application/pdf,image/*"
            onUpload={onIdUpload}
          />
          {idUrl ? (
            <p className="mt-1 text-xs text-app-fg-muted break-all">Uploaded: {idUrl}</p>
          ) : null}
        </FormField>
      </CardBody>
    </Card>
  );
}
