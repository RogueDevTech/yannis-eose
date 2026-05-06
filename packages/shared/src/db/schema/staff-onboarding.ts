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
   * Free-form supporting documents. Each entry is { label, url } — staff
   * attach as many as relevant (NIN slip, NYSC cert, school certificates, etc.).
   */
  supportingDocuments: jsonb('supporting_documents')
    .$type<Array<{ label: string; url: string }>>()
    .default([])
    .notNull(),

  // Guarantor 1 (mandatory at SUBMITTED — service-level, not DB)
  guarantor1Name: text('guarantor1_name'),
  guarantor1Phone: text('guarantor1_phone'),
  guarantor1Email: text('guarantor1_email'),
  guarantor1Address: text('guarantor1_address'),
  guarantor1Relationship: text('guarantor1_relationship'),
  guarantor1LetterUrl: text('guarantor1_letter_url'),

  // Guarantor 2 (mandatory at SUBMITTED — service-level, not DB)
  guarantor2Name: text('guarantor2_name'),
  guarantor2Phone: text('guarantor2_phone'),
  guarantor2Email: text('guarantor2_email'),
  guarantor2Address: text('guarantor2_address'),
  guarantor2Relationship: text('guarantor2_relationship'),
  guarantor2LetterUrl: text('guarantor2_letter_url'),

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
