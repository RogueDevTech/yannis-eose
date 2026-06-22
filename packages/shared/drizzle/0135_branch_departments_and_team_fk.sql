-- Departments (Marketing & CS) per branch; optional squads (branch_teams) under each;
-- teamless department roster via branch_department_members.

CREATE TABLE branch_departments (
  id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  department branch_team_department NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, department)
);

CREATE INDEX branch_departments_branch_id_idx ON branch_departments (branch_id);

CREATE TABLE branch_department_members (
  branch_department_id uuid NOT NULL REFERENCES branch_departments (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (branch_department_id, user_id)
);

CREATE INDEX branch_department_members_user_id_idx ON branch_department_members (user_id);

INSERT INTO branch_departments (branch_id, department, created_at, updated_at)
SELECT b.id, 'CS'::branch_team_department, now(), now()
FROM branches b;

INSERT INTO branch_departments (branch_id, department, created_at, updated_at)
SELECT b.id, 'MARKETING'::branch_team_department, now(), now()
FROM branches b;

ALTER TABLE branch_teams
  ADD COLUMN branch_department_id uuid REFERENCES branch_departments (id);

UPDATE branch_teams bt
SET branch_department_id = bd.id
FROM branch_departments bd
WHERE bd.branch_id = bt.branch_id AND bd.department = bt.department;

ALTER TABLE branch_teams
  ALTER COLUMN branch_department_id SET NOT NULL;

CREATE INDEX branch_teams_branch_department_id_idx ON branch_teams (branch_department_id);
