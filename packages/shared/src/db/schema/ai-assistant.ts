import { pgTable, text, jsonb, uuid, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { uuidv7Pk, timestampColumns } from './helpers';
import { users } from './users';

// ─── AI Chat Sessions ────────────────────────────────────────────────
// Each user owns zero or more chat sessions. Auto-purged after 30 days.
export const aiChatSessions = pgTable('ai_chat_sessions', {
  id: uuidv7Pk(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  title: text('title'),
  ...timestampColumns,
}, (t) => ({
  idxUserCreated: index('idx_ai_chat_sessions_user_id').on(t.userId, t.createdAt),
}));

// ─── AI Chat Messages ────────────────────────────────────────────────
// Individual messages within a session. CASCADE-deleted with the session.
export const aiChatMessages = pgTable('ai_chat_messages', {
  id: uuidv7Pk(),
  sessionId: uuid('session_id').references(() => aiChatSessions.id, { onDelete: 'cascade' }).notNull(),
  /** 'user' | 'assistant' | 'system' */
  role: text('role').notNull(),
  content: text('content').notNull(),
  /** Claude tool_use blocks for audit / replay */
  toolCalls: jsonb('tool_calls').$type<Record<string, unknown>[]>(),
  /** Tool execution results */
  toolResults: jsonb('tool_results').$type<Record<string, unknown>[]>(),
  /** { input: number, output: number } token counts */
  tokenUsage: jsonb('token_usage').$type<{ input: number; output: number }>(),
  ...timestampColumns,
}, (t) => ({
  idxSessionCreated: index('idx_ai_chat_messages_session_id').on(t.sessionId, t.createdAt),
}));

// ─── AI User API Keys ────────────────────────────────────────────────
// Personal Claude API key per user, AES-256-GCM encrypted at rest.
export const aiUserApiKeys = pgTable('ai_user_api_keys', {
  id: uuidv7Pk(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  /** Encrypted API key: "iv:authTag:ciphertext" (base64 segments) */
  encryptedKey: text('encrypted_key').notNull(),
  ...timestampColumns,
}, (t) => ({
  uniqUser: uniqueIndex('ai_user_api_keys_user_id_uniq').on(t.userId),
}));
