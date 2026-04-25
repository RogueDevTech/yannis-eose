-- Mirror Mode audit trail.
-- Permanent log of every time a SuperAdmin / Admin or Head viewed the app through
-- another user's account (read-only). One row per mirror session — `ended_at` stays
-- NULL until the actor exits the mirror.

CREATE TABLE IF NOT EXISTS mirror_sessions (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  target_id uuid NOT NULL REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mirror_sessions_actor_id_idx ON mirror_sessions(actor_id);
CREATE INDEX IF NOT EXISTS mirror_sessions_target_id_idx ON mirror_sessions(target_id);
CREATE INDEX IF NOT EXISTS mirror_sessions_started_at_idx ON mirror_sessions(started_at);
CREATE INDEX IF NOT EXISTS mirror_sessions_ended_at_idx ON mirror_sessions(ended_at);
