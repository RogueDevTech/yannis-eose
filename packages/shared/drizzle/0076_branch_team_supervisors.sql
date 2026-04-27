-- Branch supervisor teams (CS / Marketing) — graph model per branch.

CREATE TYPE branch_team_department AS ENUM ('CS', 'MARKETING');

CREATE TABLE branch_teams (
  id uuid PRIMARY KEY NOT NULL,
  branch_id uuid NOT NULL REFERENCES branches (id),
  department branch_team_department NOT NULL,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX branch_teams_branch_id_idx ON branch_teams (branch_id);

CREATE TABLE branch_team_members (
  team_id uuid NOT NULL REFERENCES branch_teams (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  is_supervisor boolean NOT NULL DEFAULT false,
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX branch_team_members_user_id_idx ON branch_team_members (user_id);
