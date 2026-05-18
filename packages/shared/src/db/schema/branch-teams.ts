import { boolean, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { branchTeamDepartmentEnum } from './enums';
import { uuidv7Pk, timestampColumns } from './helpers';
import { branches } from './branches';
import { users } from './users';

/**
 * branch_departments — fixed Marketing / CS bucket per branch (one row per department).
 * Squads (branch_teams) and department-only roster rows hang off this.
 */
export const branchDepartments = pgTable(
  'branch_departments',
  {
    id: uuidv7Pk(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    department: branchTeamDepartmentEnum('department').notNull(),
    ...timestampColumns,
  },
  (t) => ({
    branchDeptUnique: uniqueIndex('branch_departments_branch_id_department_unique').on(t.branchId, t.department),
  }),
);

export const branchDepartmentMembers = pgTable(
  'branch_department_members',
  {
    branchDepartmentId: uuid('branch_department_id')
      .notNull()
      .references(() => branchDepartments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.branchDepartmentId, t.userId] }),
  }),
);

/**
 * branch_teams — optional squads within a branch department (CS or Marketing only).
 * Supervisors and members are rows in branch_team_members.
 */
export const branchTeams = pgTable('branch_teams', {
  id: uuidv7Pk(),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id),
  branchDepartmentId: uuid('branch_department_id')
    .notNull()
    .references(() => branchDepartments.id),
  department: branchTeamDepartmentEnum('department').notNull(),
  name: text('name'),
  ...timestampColumns,
});

export const branchTeamMembers = pgTable(
  'branch_team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => branchTeams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    isSupervisor: boolean('is_supervisor').default(false).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.userId] }),
  }),
);

/**
 * branch_team_settings — per-team key/value overrides (Phase C).
 * Resolution order at read time (SettingsService.getEffectiveTeamSetting):
 *   1. enforced system value (system_settings.value where is_enforced = true)
 *   2. team override (this row)
 *   3. system default (system_settings.value where is_enforced = false)
 */
export const branchTeamSettings = pgTable(
  'branch_team_settings',
  {
    id: uuidv7Pk(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => branchTeams.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull().$type<Record<string, unknown>>(),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestampColumns,
  },
  (t) => ({
    teamKeyUnique: uniqueIndex('branch_team_settings_team_key_unique').on(t.teamId, t.key),
  }),
);
