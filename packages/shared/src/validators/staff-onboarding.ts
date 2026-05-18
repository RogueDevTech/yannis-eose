import { z } from 'zod';

export const onboardingStatusSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED']);
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;

export const staffGenderSchema = z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']);
export type StaffGender = z.infer<typeof staffGenderSchema>;

const supportingDocumentSchema = z.object({
  label: z.string().min(1).max(120),
  url: z.string().min(1).max(500),
});
export type SupportingDocument = z.infer<typeof supportingDocumentSchema>;

/**
 * Draft-friendly editable shape — every field optional, used by both staff
 * (self-edit while NOT_STARTED / IN_PROGRESS) and HR (any status). Required-at-
 * submit enforcement lives in the service layer in `assertReadyForSubmission`.
 */
export const updateOnboardingProfileSchema = z.object({
  gender: staffGenderSchema.nullish(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Date of birth must be YYYY-MM-DD')
    .nullish(),
  residentialAddress: z.string().max(500).nullish(),
  proofOfAddressUrl: z.string().max(500).nullish(),
  /** Current state of residence — validated against `NIGERIAN_STATES` on the UI. */
  currentStateOfResidence: z.string().max(80).nullish(),
  supportingDocuments: z.array(supportingDocumentSchema).max(20).optional(),

  // Identification + contracts (HR feedback 2026-05).
  signedContractUrl: z.string().max(500).nullish(),
  governmentIdUrl: z.string().max(500).nullish(),
  additionalPhoneNumbers: z.string().max(500).nullish(),

  // Statutory + financial assistance docs.
  taxId: z.string().max(60).nullish(),
  rentReceiptUrl: z.string().max(500).nullish(),

  // Academic + employment background.
  academicRecordsUrl: z.string().max(500).nullish(),
  employmentHistoryUrl: z.string().max(500).nullish(),

  // Guarantor 1 — file-only per HR feedback 2026-05. Legacy text fields kept
  // optional so existing rows can still round-trip until they re-submit.
  guarantor1Name: z.string().max(120).nullish(),
  guarantor1Phone: z.string().max(40).nullish(),
  guarantor1Email: z.string().email().max(120).nullish().or(z.literal('')),
  guarantor1Address: z.string().max(500).nullish(),
  guarantor1Relationship: z.string().max(80).nullish(),
  guarantor1LetterUrl: z.string().max(500).nullish(),
  guarantor1FormUrl: z.string().max(500).nullish(),
  guarantor1IdUrl: z.string().max(500).nullish(),

  // Guarantor 2.
  guarantor2Name: z.string().max(120).nullish(),
  guarantor2Phone: z.string().max(40).nullish(),
  guarantor2Email: z.string().email().max(120).nullish().or(z.literal('')),
  guarantor2Address: z.string().max(500).nullish(),
  guarantor2Relationship: z.string().max(80).nullish(),
  guarantor2LetterUrl: z.string().max(500).nullish(),
  guarantor2FormUrl: z.string().max(500).nullish(),
  guarantor2IdUrl: z.string().max(500).nullish(),

  /**
   * Payout beneficiary bank details. Live on `users` (finance-only visibility);
   * onboarding writes them through to the user row in the same transaction so
   * `/admin/finance/staff-accounts` and payout exports stay aligned with what
   * staff filled in here. `payoutBankCode` is auto-filled from `payoutBankName`
   * by the UI bank picker (NIGERIAN_BANKS) — server doesn't enforce that pair
   * so legacy free-text rows still round-trip.
   */
  payoutBankName: z.string().max(120).nullish(),
  payoutAccountName: z.string().max(120).nullish(),
  payoutAccountNumber: z
    .string()
    .max(40)
    .regex(/^[0-9]*$/u, 'Account number must be digits only')
    .nullish()
    .or(z.literal('')),
  payoutBankCode: z.string().max(20).nullish(),
});

export type UpdateOnboardingProfileInput = z.infer<typeof updateOnboardingProfileSchema>;

/** HR-only override — same fields as self-update, plus an optional userId target. */
export const hrUpdateOnboardingSchema = updateOnboardingProfileSchema.extend({
  userId: z.string().uuid(),
});
export type HrUpdateOnboardingInput = z.infer<typeof hrUpdateOnboardingSchema>;

export const submitOnboardingSchema = z.object({
  /** Self-submit when omitted; HR may submit on behalf. */
  userId: z.string().uuid().optional(),
});
export type SubmitOnboardingInput = z.infer<typeof submitOnboardingSchema>;

export const approveOnboardingSchema = z.object({
  userId: z.string().uuid(),
});
export type ApproveOnboardingInput = z.infer<typeof approveOnboardingSchema>;

/**
 * HR sends a SUBMITTED onboarding back to the staff member for edits.
 * Reason is required so the staff side can show a useful banner.
 */
export const requestOnboardingChangesSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(10, 'Reason must be at least 10 characters').max(1000),
});
export type RequestOnboardingChangesInput = z.infer<typeof requestOnboardingChangesSchema>;

export const getOnboardingSchema = z.object({
  /** Defaults to the caller's own onboarding when omitted. */
  userId: z.string().uuid().optional(),
});
export type GetOnboardingInput = z.infer<typeof getOnboardingSchema>;

/** HR overview table — filter by logical onboarding state (`NOT_STARTED` includes users with no row yet). */
export const staffOnboardingDocumentsFilterStatusSchema = z.enum([
  'ALL',
  'NOT_STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'APPROVED',
]);

export const listStaffOnboardingDocumentsSchema = z.object({
  search: z.string().optional(),
  onboardingStatus: staffOnboardingDocumentsFilterStatusSchema.default('ALL'),
  userStatus: z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'DEACTIVATED', 'ARCHIVED']).optional(),
  branchId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['name', 'onboardingUpdatedAt']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  /**
   * Admin-class only: bypass auto-scoping by session `currentBranchId` (same semantics as `users.list`).
   */
  allBranches: z.boolean().optional(),
});

export type ListStaffOnboardingDocumentsInput = z.infer<typeof listStaffOnboardingDocumentsSchema>;
