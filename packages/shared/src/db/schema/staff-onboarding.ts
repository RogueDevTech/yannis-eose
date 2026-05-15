import { uuid, pgTable, text, jsonb, timestamp, date } from 'drizzle-orm/pg-core';
import { onboardingStatusEnum, staffGenderEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';

/**
 * Per-user onboarding profile. Always 1:1 with users.
 *
 * Lifecycle (does NOT block account login):
 *   NOT_STARTED → IN_PROGRESS → SUBMITTED → APPROVED
 *
 * Staff edit while NOT_STARTED / IN_PROGRESS, locked once SUBMITTED, permanently
 * locked for staff once APPROVED. HR can edit at any stage.
 */
export const staffOnboarding = pgTable('staff_onboarding', {
  id: uuidv7Pk(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  status: onboardingStatusEnum('status').default('NOT_STARTED').notNull(),

  // Personal details
  gender: staffGenderEnum('gender'),
  dateOfBirth: date('date_of_birth'),
  residentialAddress: text('residential_address'),
  proofOfAddressUrl: text('proof_of_address_url'),
  /**
   * Current state of residence (Nigerian state name from NIGERIAN_STATES).
   * Required at SUBMITTED. Free-text column in DB so historical rows survive
   * a future change to the canonical list.
   */
  currentStateOfResidence: text('current_state_of_residence'),

  /**
   * Free-form supporting documents. Each entry is { label, url } — staff
   * attach as many as relevant (NIN slip, NYSC cert, school certificates, etc.).
   * Retained alongside the new typed slots below for back-compat and for any
   * extra documents HR explicitly asks for outside the standard checklist.
   */
  supportingDocuments: jsonb('supporting_documents')
    .$type<Array<{ label: string; url: string }>>()
    .default([])
    .notNull(),

  // Identification & contracts (HR feedback 2026-05) — typed slots replace
  // the prior free-form attachment list as the standard checklist.
  signedContractUrl: text('signed_contract_url'),
  governmentIdUrl: text('government_id_url'),
  /** Comma-separated additional phone numbers beyond `users.phone`. */
  additionalPhoneNumbers: text('additional_phone_numbers'),

  // Statutory + financial assistance docs
  taxId: text('tax_id'),
  rentReceiptUrl: text('rent_receipt_url'),

  // Academic + employment background
  academicRecordsUrl: text('academic_records_url'),
  employmentHistoryUrl: text('employment_history_url'),

  // Guarantor 1 — file-only per HR feedback 2026-05.
  // Old text columns kept nullable for back-compat with rows submitted before
  // the file-only switch; new submissions only require the two file uploads.
  guarantor1Name: text('guarantor1_name'),
  guarantor1Phone: text('guarantor1_phone'),
  guarantor1Email: text('guarantor1_email'),
  guarantor1Address: text('guarantor1_address'),
  guarantor1Relationship: text('guarantor1_relationship'),
  guarantor1LetterUrl: text('guarantor1_letter_url'),
  guarantor1FormUrl: text('guarantor1_form_url'),
  guarantor1IdUrl: text('guarantor1_id_url'),

  // Guarantor 2 — same shape as Guarantor 1.
  guarantor2Name: text('guarantor2_name'),
  guarantor2Phone: text('guarantor2_phone'),
  guarantor2Email: text('guarantor2_email'),
  guarantor2Address: text('guarantor2_address'),
  guarantor2Relationship: text('guarantor2_relationship'),
  guarantor2LetterUrl: text('guarantor2_letter_url'),
  guarantor2FormUrl: text('guarantor2_form_url'),
  guarantor2IdUrl: text('guarantor2_id_url'),

  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: uuid('approved_by').references(() => users.id),

  /**
   * HR "Request changes" trail. Set when HR sends a SUBMITTED onboarding back to
   * the staff for edits; cleared when the staff re-submits.
   */
  changesRequestedAt: timestamp('changes_requested_at', { withTimezone: true }),
  changesRequestedBy: uuid('changes_requested_by').references(() => users.id),
  changesRequestedReason: text('changes_requested_reason'),

  ...temporalColumns,
  ...timestampColumns,
});
