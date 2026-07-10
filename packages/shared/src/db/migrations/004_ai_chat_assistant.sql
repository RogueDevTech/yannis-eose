-- 004: AI Chat Assistant tables
-- Sessions + messages for the in-app AI assistant. Auto-purged after 30 days.
-- Personal API keys for per-user Claude API key storage (encrypted at app layer).

CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  id         UUID PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id),
  title      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_user_id
  ON ai_chat_sessions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id           UUID PRIMARY KEY,
  session_id   UUID NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  tool_calls   JSONB,
  tool_results JSONB,
  token_usage  JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session_id
  ON ai_chat_messages (session_id, created_at ASC);

CREATE TABLE IF NOT EXISTS ai_user_api_keys (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  encrypted_key TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_user_api_keys_user_id_uniq
  ON ai_user_api_keys (user_id);
