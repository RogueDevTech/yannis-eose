import { boolean, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { branchTeamDepartmentEnum } from './enums';
import { uuidv7Pk, timestampColumns } from './helpers';
import { branches } from './branches';
import { users } from './users';

/**
 * branch_teams — named or default squads within a branch (CS or Marketing only).
 * Supervisors and members are rows in branch_team_members.
 */
export const branchTeams = pgTable('branch_teams', {
  id: uuidv7Pk(),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id),
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
