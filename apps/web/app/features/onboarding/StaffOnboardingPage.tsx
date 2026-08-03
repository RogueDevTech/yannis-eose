import { useState, useMemo, type ReactNode } from 'react';
import { Form, useFetcher, useNavigation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { DescriptionList } from '~/components/ui/description-list';
import { FormField } from '~/components/ui/form-field';
import { FormSelect } from '~/components/ui/form-select';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { StatusBadge } from '~/components/ui/status-badge';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Modal } from '~/components/ui/modal';
import { FileUpload } from '~/components/ui/file-upload';
import { BankSelect } from '~/components/ui/bank-select';
import { ASSET_FOLDERS } from '~/lib/object-storage';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { NIGERIAN_STATES, resolveNigerianBank } from '@yannis/shared';

/** Public FIRS TaxProMax portal where staff can request a Tax Identification Number. */
const TAX_ID_REGISTER_URL = 'https://taxpromax.firs.gov.ng/';

const STATE_OPTIONS = [
  { value: '', label: 'Select…' },
  ...NIGERIAN_STATES.map((s) => ({ value: s, label: s })),
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
   * `self`  — the actor IS the subject. Editable until APPROVED.
   * `hr`    — HR / admin reviewing a staff member. Defaults to read-only review;
   *           field edits require an explicit Edit click when `canHrEdit`.
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
  /** HR mode: allow field edits (requires hr.onboarding.write). Approve can still show without this. */
  canHrEdit?: boolean;
  /** Self mode: viewer holds hr.onboarding.approveSelf, so they may approve their own submitted record. */
  canApproveSelf?: boolean;
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

function formatStatusLabel(status: OnboardingStatus, subjectRole?: string): string {
  switch (status) {
    case 'NOT_STARTED':
      return 'Not started';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'SUBMITTED':
      // HR / Admin / SuperAdmin packets are reviewed by Super Admin, not peer HR.
      if (
        subjectRole === 'HR_MANAGER' ||
        subjectRole === 'SUPER_ADMIN' ||
        subjectRole === 'ADMIN'
      ) {
        return 'Pending Super Admin review';
      }
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

function looksLikeImageUrl(url: string): boolean {
  const path = url.split('?')[0]?.toLowerCase() ?? '';
  return /\.(png|jpe?g|gif|webp|avif|bmp)$/.test(path);
}

/** Dense review/edit chip: small thumb + short label. */
function DocumentChip({ href, label }: { href: string; label: string }) {
  const isImage = looksLikeImageUrl(href);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 rounded border border-app-border bg-app-elevated p-0.5 pr-2 text-left transition-colors hover:border-brand-400/40 hover:bg-app-hover"
    >
      {isImage ? (
        <img
          src={href}
          alt=""
          className="h-8 w-8 shrink-0 rounded-sm object-cover bg-app-hover"
        />
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-app-hover text-[9px] font-semibold uppercase tracking-wide text-app-fg-muted">
          PDF
        </div>
      )}
      <span className="min-w-0">
        <span className="block truncate text-2xs font-medium leading-tight text-app-fg">{label}</span>
        <span className="block text-micro leading-tight text-brand-600 dark:text-brand-400">Open ↗</span>
      </span>
    </a>
  );
}

function ReviewSection({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card padding="sm" className="!rounded-lg">
      <CardHeader
        title={title}
        actions={actions}
        className="!mb-2"
      />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/** Compact upload field: existing file as chip + Remove, or minimal FileUpload when empty. */
function DocumentFieldEditor({
  label,
  hint,
  url,
  onChange,
  className,
}: {
  label: string;
  hint?: ReactNode;
  url: string;
  onChange: (url: string) => void;
  className?: string;
}) {
  return (
    <FormField label={label} hint={hint} className={className}>
      {url ? (
        <div className="flex flex-wrap items-center gap-2">
          <DocumentChip href={url} label="On file" />
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
            Remove
          </Button>
        </div>
      ) : (
        <FileUpload
          folder={ASSET_FOLDERS.ONBOARDING_DOCS}
          accept="application/pdf,image/*"
          onUpload={onChange}
          variant="minimal"
          size="sm"
        />
      )}
    </FormField>
  );
}

function OnboardingReadOnlyView({
  record,
  hideBank = false,
  onEditBank,
}: {
  record: OnboardingRecord;
  /** When HR is editing payroll bank below, skip the read-only bank card. */
  hideBank?: boolean;
  /** HR: show Edit on the payroll card (read-only until clicked). */
  onEditBank?: () => void;
}) {
  const genderDisplay = formatGenderLabel(record.gender);
  const dobDisplay = formatDobDisplay(record.dateOfBirth);
  const empty = <span className="text-app-fg-muted">Not provided</span>;

  const docChips: Array<{ href: string; label: string }> = [
    record.proofOfAddressUrl ? { href: record.proofOfAddressUrl, label: 'Proof of address' } : null,
    record.signedContractUrl ? { href: record.signedContractUrl, label: 'Signed contract' } : null,
    record.governmentIdUrl ? { href: record.governmentIdUrl, label: 'Government ID' } : null,
    record.rentReceiptUrl ? { href: record.rentReceiptUrl, label: 'Rent receipt' } : null,
    record.academicRecordsUrl ? { href: record.academicRecordsUrl, label: 'Academic records' } : null,
    record.employmentHistoryUrl
      ? { href: record.employmentHistoryUrl, label: 'Employment history' }
      : null,
    ...record.supportingDocuments.map((doc) => ({
      href: doc.url,
      label: doc.label?.trim() || 'Untitled',
    })),
  ].filter((x): x is { href: string; label: string } => x != null);

  return (
    <div className="space-y-2">
      <ReviewSection title="Personal details">
        <DescriptionList
          layout="grid"
          dense
          mobileColumns={2}
          gridColumns={3}
          items={[
            { label: 'Gender', value: genderDisplay || empty },
            { label: 'Date of birth', value: dobDisplay || empty },
            {
              label: 'State',
              value: record.currentStateOfResidence?.trim()
                ? record.currentStateOfResidence
                : empty,
            },
            {
              label: 'Address',
              value: record.residentialAddress?.trim() ? (
                <span className="whitespace-pre-wrap">{record.residentialAddress}</span>
              ) : (
                empty
              ),
              fullWidth: true,
            },
            {
              label: 'Extra phones',
              value: record.additionalPhoneNumbers?.trim()
                ? record.additionalPhoneNumbers
                : empty,
              fullWidth: true,
            },
            {
              label: 'Tax ID (TIN)',
              value: record.taxId?.trim() ? (
                <span className="tabular-nums">{record.taxId}</span>
              ) : (
                empty
              ),
            },
          ]}
        />
      </ReviewSection>

      <ReviewSection title="Documents">
        {docChips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {docChips.map((doc) => (
              <DocumentChip key={`${doc.label}-${doc.href}`} href={doc.href} label={doc.label} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-app-fg-muted">No documents on file.</p>
        )}
      </ReviewSection>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <GuarantorReadOnlyCard index={1} record={record} />
        <GuarantorReadOnlyCard index={2} record={record} />
      </div>

      {hideBank ? null : <BankDetailsReadOnlyCard record={record} onEdit={onEditBank} />}
    </div>
  );
}

/** HR-only payroll bank editor (shown only after Edit on the read-only card). */
function HrPayrollBankForm({
  bankName,
  bankCode,
  accountName,
  accountNumber,
  onBankChange,
  onAccountNameChange,
  onAccountNumberChange,
  saving,
  error,
  onSave,
  onCancel,
}: {
  bankName: string;
  bankCode: string;
  accountName: string;
  accountNumber: string;
  onBankChange: (next: { bankName: string; bankCode: string }) => void;
  onAccountNameChange: (value: string) => void;
  onAccountNumberChange: (value: string) => void;
  saving: boolean;
  error?: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Card>
      <CardHeader
        title="Payroll account"
        description="Edit the staff member's bank details used for monthly payroll. Changes save to their user record immediately."
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <BankSelect
            id="hr-onboarding-bank"
            bankName={bankName}
            bankCode={bankCode}
            onChange={onBankChange}
            nameBankName="payoutBankName"
            nameBankCode="payoutBankCode"
            label="Bank"
            hint="Search and pick the staff member's bank. Bank code fills in automatically."
            placeholder="Select bank…"
            className="sm:col-span-2"
            required
          />
          <FormField label="Account name" hint="As it appears on the bank statement">
            <TextInput
              name="payoutAccountName"
              value={accountName}
              onChange={(e) => onAccountNameChange(e.target.value)}
              maxLength={120}
            />
          </FormField>
          <FormField label="Account number" hint="10-digit NUBAN">
            <TextInput
              name="payoutAccountNumber"
              value={accountNumber}
              onChange={(e) => onAccountNumberChange(e.target.value)}
              maxLength={20}
              inputMode="numeric"
              pattern="[0-9]*"
            />
          </FormField>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={saving} onClick={onSave}>
            Save payroll account
          </Button>
        </div>
        {error ? (
          <p className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-900/30 dark:text-danger-200">
            {error}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function BankDetailsReadOnlyCard({
  record,
  onEdit,
}: {
  record: OnboardingRecord;
  onEdit?: () => void;
}) {
  const empty = <span className="text-app-fg-muted">Not provided</span>;
  return (
    <ReviewSection
      title="Payroll account"
      actions={
        onEdit ? (
          <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
            Edit
          </Button>
        ) : undefined
      }
    >
      <DescriptionList
        layout="grid"
        dense
        mobileColumns={2}
        gridColumns={4}
        items={[
          { label: 'Bank', value: record.payoutBankName?.trim() ? record.payoutBankName : empty },
          {
            label: 'Account name',
            value: record.payoutAccountName?.trim() ? record.payoutAccountName : empty,
          },
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
    </ReviewSection>
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

  const chips: Array<{ href: string; label: string }> = [
    formUrl ? { href: formUrl, label: 'Form' } : null,
    idUrl ? { href: idUrl, label: 'ID' } : null,
    legacyLetter?.trim() ? { href: legacyLetter, label: 'Legacy letter' } : null,
  ].filter((x): x is { href: string; label: string } => x != null);

  return (
    <ReviewSection title={`Guarantor ${index}`}>
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <DocumentChip key={`${c.label}-${c.href}`} href={c.href} label={c.label} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-app-fg-muted">Not provided</p>
      )}
      {hasLegacy && (legacyName?.trim() || legacyPhone?.trim()) ? (
        <p className="mt-1.5 text-2xs text-app-fg-muted">
          {[legacyName?.trim(), legacyPhone?.trim()].filter(Boolean).join(' · ')}
        </p>
      ) : null}
    </ReviewSection>
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
  canHrEdit = false,
  canApproveSelf = false,
}: StaffOnboardingPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const navigation = useNavigation();

  useFetcherToast(fetcher.data, { successMessage: 'Onboarding saved' });

  // HR lands on review; edit form only after explicit Edit. Self stays editable
  // until APPROVED. Payroll bank has a dedicated editor on the review surface
  // (including after approval).
  const canEnterHrEdit =
    mode === 'hr' && canHrEdit && !isMirroring && record.status !== 'APPROVED';
  const [hrEditing, setHrEditing] = useState(false);
  /** Payroll bank has its own Edit gate (including after approval). */
  const [hrEditingPayroll, setHrEditingPayroll] = useState(false);
  const showEditForm =
    !isMirroring &&
    record.status !== 'APPROVED' &&
    (mode === 'self' || (mode === 'hr' && canHrEdit && hrEditing));
  const showHrReviewActions =
    mode === 'hr' && record.status === 'SUBMITTED' && !isMirroring && !hrEditing;
  // HR set the staff up themselves: the packet never got self-submitted, so it
  // sits at IN_PROGRESS/NOT_STARTED forever. Let HR complete & approve it in one
  // step (backend re-checks the submission checklist + hr.onboarding.approve).
  const showHrCompleteAction =
    mode === 'hr' &&
    canHrEdit &&
    !isMirroring &&
    !hrEditing &&
    (record.status === 'IN_PROGRESS' || record.status === 'NOT_STARTED');
  const canEditPayrollBank = mode === 'hr' && canHrEdit && !isMirroring && !hrEditing;
  const showHrPayrollBankEditor = canEditPayrollBank && hrEditingPayroll;

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
  // Bank picker — selecting a bank sets both name and NIP code together.
  const initialBank = resolveNigerianBank({
    name: record.payoutBankName,
    code: record.payoutBankCode,
  });
  const [bankName, setBankName] = useState(initialBank?.name ?? record.payoutBankName ?? '');
  const [bankCode, setBankCode] = useState(initialBank?.code ?? record.payoutBankCode ?? '');
  const [accountName, setAccountName] = useState(record.payoutAccountName ?? '');
  const [accountNumber, setAccountNumber] = useState(record.payoutAccountNumber ?? '');
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const [requestChangesReason, setRequestChangesReason] = useState('');

  // Required-at-submit checklist, mirroring the server guard in
  // onboarding.service.submit(). Personal fields read from the saved record
  // (they only persist on draft-save); bank fields use the live picker state.
  // Save your draft first, then these clear. Documents stay optional.
  const missingRequiredFields = useMemo(() => {
    const missing: string[] = [];
    if (!bankName.trim() || !bankCode.trim() || !accountName.trim() || !accountNumber.trim()) {
      missing.push('Bank details');
    }
    if (!record.gender) missing.push('Gender');
    if (!record.dateOfBirth) missing.push('Date of birth');
    if (!record.residentialAddress?.trim()) missing.push('Residential address');
    if (!record.currentStateOfResidence?.trim()) missing.push('Current state of residence');
    return missing;
  }, [
    bankName,
    bankCode,
    accountName,
    accountNumber,
    record.gender,
    record.dateOfBirth,
    record.residentialAddress,
    record.currentStateOfResidence,
  ]);

  const handleBankChange = (next: { bankName: string; bankCode: string }) => {
    setBankName(next.bankName);
    setBankCode(next.bankCode);
  };

  const resetDocumentStateFromRecord = () => {
    setProofUrl(record.proofOfAddressUrl ?? '');
    setSignedContractUrl(record.signedContractUrl ?? '');
    setGovernmentIdUrl(record.governmentIdUrl ?? '');
    setRentReceiptUrl(record.rentReceiptUrl ?? '');
    setAcademicRecordsUrl(record.academicRecordsUrl ?? '');
    setEmploymentHistoryUrl(record.employmentHistoryUrl ?? '');
    setG1Form(record.guarantor1FormUrl ?? '');
    setG1IdDoc(record.guarantor1IdUrl ?? '');
    setG2Form(record.guarantor2FormUrl ?? '');
    setG2IdDoc(record.guarantor2IdUrl ?? '');
    setSupportingDocs(record.supportingDocuments);
    const bank = resolveNigerianBank({
      name: record.payoutBankName,
      code: record.payoutBankCode,
    });
    setBankName(bank?.name ?? record.payoutBankName ?? '');
    setBankCode(bank?.code ?? record.payoutBankCode ?? '');
    setAccountName(record.payoutAccountName ?? '');
    setAccountNumber(record.payoutAccountNumber ?? '');
  };

  // Close confirm modals only AFTER the action returns success — keeps the
  // user on the spinner until the request actually resolves so they know
  // whether it went through.
  useCloseOnFetcherSuccess(fetcher, () => {
    setConfirmSubmit(false);
    setConfirmApprove(false);
    setConfirmComplete(false);
    setRequestChangesOpen(false);
    setRequestChangesReason('');
  });
  // HR edit session ends after a successful save so they land back on review.
  useCloseOnFetcherSuccess(
    fetcher,
    () => {
      if (mode === 'hr') {
        setHrEditing(false);
        setHrEditingPayroll(false);
      }
    },
    { intent: 'updateOnboarding' },
  );

  const isSavingDraft =
    fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'updateOnboarding';
  const isSubmitting =
    fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'submitOnboarding';
  const isApproving =
    fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'approveOnboarding';
  const isCompleting =
    fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'completeAndApproveOnboarding';
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
    fd.set('payoutAccountName', accountName);
    fd.set('payoutAccountNumber', accountNumber);
    fetcher.submit(fd, { method: 'post', action: actionUrl });
  };

  const handleSavePayrollBank = () => {
    const fd = new FormData();
    fd.set('intent', 'updateOnboarding');
    fd.set('payoutBankName', bankName);
    fd.set('payoutBankCode', bankCode);
    fd.set('payoutAccountName', accountName);
    fd.set('payoutAccountNumber', accountNumber);
    // Keep supporting docs shape valid for the shared update schema.
    fd.set('supportingDocuments', JSON.stringify(supportingDocs));
    fetcher.submit(fd, { method: 'post', action: actionUrl });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={mode === 'self' ? 'Your onboarding' : `Onboarding: ${subject.name}`}
        backTo={showBackToProfile ? `/hr/users/${subject.id}` : undefined}
        mobileInlineActions
        description={
          mode === 'self'
            ? 'Complete your documents and submit when ready.'
            : hrEditing
              ? 'Editing staff onboarding. Save or cancel when done.'
              : 'Review the documents below. Use Edit to correct details, or approve when ready.'
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Onboarding toolbar"
            saveFilterKey
            desktop={
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={record.status}
                  label={formatStatusLabel(record.status, subject.role)}
                />
                {submittedDate ? (
                  <span className="text-xs text-app-fg-muted">Submitted {submittedDate}</span>
                ) : null}
                {approvedDate ? (
                  <span className="text-xs text-app-fg-muted">Approved {approvedDate}</span>
                ) : null}
                {canEnterHrEdit && !hrEditing ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setHrEditing(true)}>
                    Edit
                  </Button>
                ) : null}
                {hrEditing ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      resetDocumentStateFromRecord();
                      setHrEditing(false);
                    }}
                  >
                    Cancel edit
                  </Button>
                ) : null}
                <PageRefreshButton />
              </div>
            }
            sheet={
              <div className="flex flex-col gap-3 px-1">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge
                    status={record.status}
                    label={formatStatusLabel(record.status, subject.role)}
                  />
                  <span className="text-xs text-app-fg-muted">
                    {approvedDate ? `Approved ${approvedDate}` : submittedDate ? `Submitted ${submittedDate}` : ''}
                  </span>
                </div>
                {canEnterHrEdit && !hrEditing ? (
                  <Button type="button" variant="secondary" onClick={() => setHrEditing(true)}>
                    Edit
                  </Button>
                ) : null}
                {hrEditing ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      resetDocumentStateFromRecord();
                      setHrEditing(false);
                    }}
                  >
                    Cancel edit
                  </Button>
                ) : null}
              </div>
            }
          />
        }
      />

      <MobileDateFilterRow hideDate />

      {isMirroring ? (
        <div className="rounded-lg border border-success-300 bg-success-50 p-3 text-sm text-success-900 dark:border-success-700 dark:bg-success-900/20 dark:text-success-100">
          <p className="font-semibold">Read-only. Mirror Mode</p>
          <p className="mt-1">
            You're viewing this onboarding as {subject.name}. Form fields, file uploads,
            save and submit are disabled. Exit Mirror Mode from the header to make changes
            on your own account.
          </p>
        </div>
      ) : null}

      {mode === 'self' && !isMirroring && record.status === 'APPROVED' ? (
        <div className="rounded-lg border border-app-border bg-app-hover/50 p-3 text-sm text-app-fg-muted">
          Your onboarding has been approved by {reviewerLabel(subject.role)} and is now locked.
          Contact {reviewerLabel(subject.role)} if anything needs to change.
          {approverName ? <span className="ml-1">Approved by {approverName}.</span> : null}
        </div>
      ) : null}

      {mode === 'self' && !isMirroring && record.status === 'SUBMITTED' ? (
        <div className="rounded-lg border border-app-border bg-app-hover/50 p-3 text-sm text-app-fg-muted space-y-2">
          {canApproveSelf ? (
            <>
              <p>
                Your onboarding is submitted. You are authorized to approve your own onboarding.
              </p>
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={isApproving}
                onClick={() => setConfirmApprove(true)}
              >
                Approve my onboarding
              </Button>
            </>
          ) : (
            <>
              Your onboarding is waiting for review by {reviewerLabel(subject.role)}. You can still
              update your details until it is approved.
            </>
          )}
        </div>
      ) : null}

      {mode === 'hr' && !isMirroring && record.status === 'SUBMITTED' && !hrEditing ? (
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900 dark:border-brand-800 dark:bg-brand-900/20 dark:text-brand-100">
          Pending review. Use Edit to correct details, or request changes / approve below.
        </div>
      ) : null}

      {mode === 'self' && showEditForm && record.changesRequestedReason ? (
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
      {!showEditForm ? (
        <div className="space-y-4">
          {canEnterHrEdit ? (
            <div className="flex flex-wrap items-center justify-end gap-2 sm:hidden">
              <Button type="button" variant="secondary" onClick={() => setHrEditing(true)}>
                Edit
              </Button>
            </div>
          ) : null}

          <OnboardingReadOnlyView
            record={record}
            hideBank={showHrPayrollBankEditor}
            onEditBank={
              canEditPayrollBank && !hrEditingPayroll
                ? () => setHrEditingPayroll(true)
                : undefined
            }
          />

          {showHrPayrollBankEditor ? (
            <HrPayrollBankForm
              bankName={bankName}
              bankCode={bankCode}
              accountName={accountName}
              accountNumber={accountNumber}
              onBankChange={handleBankChange}
              onAccountNameChange={setAccountName}
              onAccountNumberChange={setAccountNumber}
              saving={isSavingDraft}
              error={fetcher.data?.error}
              onSave={handleSavePayrollBank}
              onCancel={() => {
                resetDocumentStateFromRecord();
                setHrEditingPayroll(false);
              }}
            />
          ) : null}

          {showHrReviewActions ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
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
            </div>
          ) : null}

          {showHrCompleteAction ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="primary"
                loading={isCompleting}
                onClick={() => setConfirmComplete(true)}
              >
                Complete &amp; approve
              </Button>
            </div>
          ) : null}

          {fetcher.data?.error && !showHrPayrollBankEditor ? (
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
              <FormField label="Additional phone numbers" hint="Optional. Separate with commas.">
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
              <DocumentFieldEditor
                label="Proof of address"
                hint="Utility bill or bank statement (PDF / image, ≤10MB)"
                url={proofUrl}
                onChange={setProofUrl}
                className="sm:col-span-2"
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Identification & contracts"
              description="Signed contract and a government-issued ID. Optional for now; HR may ask for them later."
            />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DocumentFieldEditor
                label="Signed contract"
                hint="PDF or image, ≤10MB"
                url={signedContractUrl}
                onChange={setSignedContractUrl}
              />
              <DocumentFieldEditor
                label="Government ID"
                hint="NIN slip OR international passport (PDF / image, ≤10MB)"
                url={governmentIdUrl}
                onChange={setGovernmentIdUrl}
              />
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
              <DocumentFieldEditor
                label="Rent receipt"
                hint="Optional. PDF or image, ≤10MB."
                url={rentReceiptUrl}
                onChange={setRentReceiptUrl}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Academic & employment background"
              description="Attach one combined PDF per row: certificates, transcripts, CV, prior employment letters."
            />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DocumentFieldEditor
                label="Academic records"
                hint="PDF or image, ≤10MB"
                url={academicRecordsUrl}
                onChange={setAcademicRecordsUrl}
              />
              <DocumentFieldEditor
                label="Employment history"
                hint="PDF or image, ≤10MB"
                url={employmentHistoryUrl}
                onChange={setEmploymentHistoryUrl}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Other supporting documents"
              description="Optional. Anything outside the standard checklist HR should keep on file."
            />
            <CardBody className="space-y-3">
              {supportingDocs.length === 0 ? (
                <p className="text-sm text-app-fg-muted">No documents attached yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {supportingDocs.map((doc, idx) => (
                    <div key={`${doc.url}-${idx}`} className="inline-flex items-center gap-1">
                      <DocumentChip href={doc.url} label={doc.label || 'Untitled'} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSupportingDocs((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
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
              title={mode === 'hr' ? 'Payroll account' : 'Payout bank details'}
              description={
                mode === 'hr'
                  ? 'Staff payroll bank account used by Finance. You can correct these details while reviewing.'
                  : 'Where Finance sends your payroll. Bank, bank code, account name, and account number are required before review.'
              }
            />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <BankSelect
                id="onboarding-bank"
                bankName={bankName}
                bankCode={bankCode}
                onChange={handleBankChange}
                nameBankName="payoutBankName"
                nameBankCode="payoutBankCode"
                label="Bank"
                hint={
                  mode === 'hr'
                    ? 'Search and pick the staff member\'s bank. Bank code fills in automatically.'
                    : 'Search and pick your bank. The NIBSS bank code fills in automatically.'
                }
                placeholder="Select bank…"
                className="sm:col-span-2"
                required
              />
              <FormField label="Account name" hint="As it appears on the bank statement">
                <TextInput
                  name="payoutAccountName"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  maxLength={120}
                />
              </FormField>
              <FormField label="Account number" hint="10-digit NUBAN">
                <TextInput
                  name="payoutAccountNumber"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  maxLength={20}
                  inputMode="numeric"
                  pattern="[0-9]*"
                />
              </FormField>
            </CardBody>
          </Card>

          {mode === 'self' &&
          (record.status === 'IN_PROGRESS' || record.status === 'NOT_STARTED') &&
          missingRequiredFields.length > 0 ? (
            <p className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:border-warning-800 dark:bg-warning-900/30 dark:text-warning-200">
              Complete and save these before you can submit: {missingRequiredFields.join(', ')}.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {mode === 'hr' ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  resetDocumentStateFromRecord();
                  setHrEditing(false);
                }}
                disabled={isSavingDraft}
              >
                Cancel
              </Button>
            ) : null}
            <Button type="submit" variant="secondary" loading={isSavingDraft || navigation.state === 'submitting'}>
              {mode === 'hr'
                ? 'Save changes'
                : record.status === 'SUBMITTED'
                  ? 'Save changes'
                  : 'Save draft'}
            </Button>
            {mode === 'self' &&
            (record.status === 'IN_PROGRESS' || record.status === 'NOT_STARTED') ? (
              <Button
                type="button"
                variant="primary"
                loading={isSubmitting}
                disabled={missingRequiredFields.length > 0}
                title={
                  missingRequiredFields.length > 0
                    ? `Complete and save: ${missingRequiredFields.join(', ')}`
                    : undefined
                }
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
        description="After submission, HR will review it. You can still update your details while it is pending."
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

      <ConfirmActionModal
        open={confirmComplete}
        onClose={() => setConfirmComplete(false)}
        title="Complete and approve onboarding?"
        description="Marks this onboarding complete on the staff member's behalf and approves it. Bank and core details must be filled in. The record then locks and payroll can proceed."
        confirmLabel="Complete & approve"
        variant="warning"
        loading={isCompleting}
        onConfirm={() => {
          const fd = new FormData();
          fd.set('intent', 'completeAndApproveOnboarding');
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
              placeholder="e.g. Re-upload the proof of address. The current file is unreadable."
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
          <div className="flex flex-wrap items-center gap-2">
            <DocumentChip href={url} label="Ready to add" />
            <Button type="button" variant="ghost" size="sm" onClick={() => setUrl('')} disabled={disabled}>
              Remove
            </Button>
          </div>
        ) : (
          <FileUpload
            folder={ASSET_FOLDERS.ONBOARDING_DOCS}
            accept="application/pdf,image/*"
            onUpload={setUrl}
            variant="minimal"
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
        description="Upload the signed guarantor form and a means of ID. Optional for now; HR may ask for them later."
      />
      <CardBody className="grid grid-cols-1 gap-3">
        <DocumentFieldEditor
          label="Signed guarantor form"
          hint="PDF or image, ≤10MB"
          url={formUrl}
          onChange={onFormUpload}
        />
        <DocumentFieldEditor
          label="Means of ID"
          hint="NIN slip / passport / driver's licence (PDF / image, ≤10MB)"
          url={idUrl}
          onChange={onIdUpload}
        />
      </CardBody>
    </Card>
  );
}
