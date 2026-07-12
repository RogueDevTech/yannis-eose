import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, lt, desc, asc, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { randomUUID } from 'crypto';
import { DRIZZLE } from '../database/database.module';
import { encryptApiKey, decryptApiKey } from '../common/utils/encryption';
import { AI_TOOLS } from './ai-tool-definitions';
import { executeTool, type ToolExecutorContext, type ToolExecutorServices, type ToolExecutorUser } from './ai-tool-executor';

// ─── System Prompt ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Yannis EOSE AI Assistant, a helpful tool built into an ERP/sales platform. You help users understand their business data, generate reports, and answer questions about how the app works.

## Your Capabilities
- Query order data (status counts, filters, lists)
- Pull financial reports (revenue, profit, margins, COGS)
- Check marketing metrics (ad spend, CPA, ROAS, media buyer performance)
- View inventory levels across products and locations
- List staff members by role, status, or search
- Check logistics health (stuck orders, transfer delays, shrinkage)
- Query the product catalog
- Answer questions about how the app works (order lifecycle, roles, features)

## Order Lifecycle
UNPROCESSED > CS_ASSIGNED > CS_ENGAGED > CONFIRMED > AGENT_ASSIGNED > DISPATCHED > IN_TRANSIT > DELIVERED > REMITTED
No state skipping. DELETED replaces the old CANCELLED status.

## Key Roles
- SUPER_ADMIN / ADMIN: Full access
- SUPPORT: Read-only admin access
- HEAD_OF_MARKETING / MEDIA_BUYER: Marketing funnel
- HEAD_OF_CS / CS_CLOSER: Sales/confirmation funnel
- HEAD_OF_LOGISTICS / STOCK_MANAGER / TPL_MANAGER / TPL_RIDER: Logistics chain
- FINANCE_OFFICER: Financial operations
- HR_MANAGER: Staff management
- BRANCH_ADMIN: Branch-level administration

## Rules
- Never fabricate data. If a tool returns empty results, say so clearly.
- Use markdown for formatting. Use tables for tabular data.
- Be concise and direct. Lead with the answer.
- When showing financial data, format numbers with commas and currency where appropriate.
- Never mention internal implementation details, tool names, or system architecture.
- If the user asks something you can't answer with the available tools, say so and suggest what they could check manually.
- If a tool returns an error saying the user lacks permission, explain that they don't have access to that specific data and suggest they contact their admin.`;

// ─── Rate Limiting (in-memory, per-process) ──────────────────────────

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX = 30;
const rateBuckets = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count++;
  return true;
}

// ─── Service ─────────────────────────────────────────────────────────

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  // ── Session CRUD ─────────────────────────────────────

  async createSession(userId: string, title?: string): Promise<{ id: string }> {
    const id = randomUUID();
    await this.db.insert(schema.aiChatSessions).values({
      id,
      userId,
      title: title || 'New conversation',
    });
    return { id };
  }

  async listSessions(userId: string, limit = 20, offset = 0) {
    const sessions = await this.db
      .select({
        id: schema.aiChatSessions.id,
        title: schema.aiChatSessions.title,
        createdAt: schema.aiChatSessions.createdAt,
        updatedAt: schema.aiChatSessions.updatedAt,
      })
      .from(schema.aiChatSessions)
      .where(eq(schema.aiChatSessions.userId, userId))
      .orderBy(desc(schema.aiChatSessions.updatedAt))
      .limit(limit)
      .offset(offset);
    return sessions;
  }

  async getSessionMessages(sessionId: string, userId: string) {
    // Ownership check
    const [session] = await this.db
      .select({ id: schema.aiChatSessions.id })
      .from(schema.aiChatSessions)
      .where(
        and(
          eq(schema.aiChatSessions.id, sessionId),
          eq(schema.aiChatSessions.userId, userId),
        ),
      )
      .limit(1);

    if (!session) throw new Error('Session not found');

    return this.db
      .select({
        id: schema.aiChatMessages.id,
        role: schema.aiChatMessages.role,
        content: schema.aiChatMessages.content,
        createdAt: schema.aiChatMessages.createdAt,
      })
      .from(schema.aiChatMessages)
      .where(eq(schema.aiChatMessages.sessionId, sessionId))
      .orderBy(asc(schema.aiChatMessages.createdAt));
  }

  async deleteSession(sessionId: string, userId: string) {
    const deleted = await this.db
      .delete(schema.aiChatSessions)
      .where(
        and(
          eq(schema.aiChatSessions.id, sessionId),
          eq(schema.aiChatSessions.userId, userId),
        ),
      )
      .returning({ id: schema.aiChatSessions.id });

    if (deleted.length === 0) throw new Error('Session not found');
  }

  // ── API Key Management ───────────────────────────────

  async saveOrgApiKey(apiKey: string, groupId: string | null, updatedBy: string): Promise<void> {
    const encrypted = encryptApiKey(apiKey);
    const existing = await this.db
      .select({ id: schema.systemSettings.id })
      .from(schema.systemSettings)
      .where(
        and(
          eq(schema.systemSettings.key, 'AI_CLAUDE_API_KEY'),
          groupId
            ? eq(schema.systemSettings.groupId, groupId)
            : undefined as any,
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(schema.systemSettings)
        .set({ value: { encryptedKey: encrypted }, updatedBy })
        .where(eq(schema.systemSettings.id, existing[0]!.id));
    } else {
      await this.db.insert(schema.systemSettings).values({
        id: randomUUID(),
        key: 'AI_CLAUDE_API_KEY',
        groupId,
        value: { encryptedKey: encrypted },
        updatedBy,
      });
    }
  }

  async deleteOrgApiKey(groupId: string | null): Promise<void> {
    await this.db
      .delete(schema.systemSettings)
      .where(
        and(
          eq(schema.systemSettings.key, 'AI_CLAUDE_API_KEY'),
          groupId
            ? eq(schema.systemSettings.groupId, groupId)
            : undefined as any,
        ),
      );
  }

  async orgApiKeyExists(groupId: string | null): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.systemSettings.id })
      .from(schema.systemSettings)
      .where(
        and(
          eq(schema.systemSettings.key, 'AI_CLAUDE_API_KEY'),
          groupId
            ? eq(schema.systemSettings.groupId, groupId)
            : undefined as any,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async savePersonalApiKey(apiKey: string, userId: string): Promise<void> {
    const encrypted = encryptApiKey(apiKey);
    const existing = await this.db
      .select({ id: schema.aiUserApiKeys.id })
      .from(schema.aiUserApiKeys)
      .where(eq(schema.aiUserApiKeys.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(schema.aiUserApiKeys)
        .set({ encryptedKey: encrypted, updatedAt: new Date() })
        .where(eq(schema.aiUserApiKeys.id, existing[0]!.id));
    } else {
      await this.db.insert(schema.aiUserApiKeys).values({
        id: randomUUID(),
        userId,
        encryptedKey: encrypted,
      });
    }
  }

  async deletePersonalApiKey(userId: string): Promise<void> {
    await this.db
      .delete(schema.aiUserApiKeys)
      .where(eq(schema.aiUserApiKeys.userId, userId));
  }

  async personalApiKeyExists(userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.aiUserApiKeys.id })
      .from(schema.aiUserApiKeys)
      .where(eq(schema.aiUserApiKeys.userId, userId))
      .limit(1);
    return rows.length > 0;
  }

  private async resolveApiKey(userId: string, groupId: string | null): Promise<string | null> {
    // Personal key takes priority
    const [personal] = await this.db
      .select({ encryptedKey: schema.aiUserApiKeys.encryptedKey })
      .from(schema.aiUserApiKeys)
      .where(eq(schema.aiUserApiKeys.userId, userId))
      .limit(1);

    if (personal) {
      try {
        return decryptApiKey(personal.encryptedKey);
      } catch {
        this.logger.warn(`Failed to decrypt personal API key for user ${userId}`);
      }
    }

    // Fallback to org key
    const [org] = await this.db
      .select({ value: schema.systemSettings.value })
      .from(schema.systemSettings)
      .where(
        and(
          eq(schema.systemSettings.key, 'AI_CLAUDE_API_KEY'),
          groupId
            ? eq(schema.systemSettings.groupId, groupId)
            : undefined as any,
        ),
      )
      .limit(1);

    if (org?.value && typeof org.value === 'object' && 'encryptedKey' in org.value) {
      try {
        return decryptApiKey(org.value.encryptedKey as string);
      } catch {
        this.logger.warn('Failed to decrypt org API key');
      }
    }

    return null;
  }

  // ── Chat ─────────────────────────────────────────────

  async sendMessage(params: {
    sessionId?: string;
    userId: string;
    userMessage: string;
    model?: string;
    user: ToolExecutorUser;
    branchId: string | null;
    effectiveBranchIds: string[] | null;
    activeGroupId: string | null;
    services: ToolExecutorServices;
  }): Promise<{
    sessionId: string;
    assistantMessage: string;
    sessionTitle?: string;
  }> {
    const { userId, userMessage, model, user, branchId, effectiveBranchIds, activeGroupId, services } = params;

    // Rate limit
    if (!checkRateLimit(userId)) {
      throw new Error('Rate limit exceeded. Please wait a few minutes before sending more messages.');
    }

    // Resolve API key
    const apiKey = await this.resolveApiKey(userId, activeGroupId);
    if (!apiKey) {
      throw new Error('No Claude API key configured. Please add your API key in the AI Assistant settings, or ask your admin to set an organization key.');
    }

    // Create or verify session
    let sessionId = params.sessionId;
    if (!sessionId) {
      const session = await this.createSession(userId);
      sessionId = session.id;
    } else {
      // Verify ownership
      const [session] = await this.db
        .select({ id: schema.aiChatSessions.id })
        .from(schema.aiChatSessions)
        .where(
          and(
            eq(schema.aiChatSessions.id, sessionId),
            eq(schema.aiChatSessions.userId, userId),
          ),
        )
        .limit(1);
      if (!session) throw new Error('Session not found');
    }

    // Persist user message
    await this.db.insert(schema.aiChatMessages).values({
      id: randomUUID(),
      sessionId,
      role: 'user',
      content: userMessage,
    });

    // Load conversation history (last 50 messages for context)
    const history = await this.db
      .select({
        role: schema.aiChatMessages.role,
        content: schema.aiChatMessages.content,
      })
      .from(schema.aiChatMessages)
      .where(eq(schema.aiChatMessages.sessionId, sessionId))
      .orderBy(asc(schema.aiChatMessages.createdAt))
      .limit(50);

    // Build messages array for Claude
    const messages = history.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

    // Call Claude with tool loop
    const toolCtx: ToolExecutorContext = { user, branchId, effectiveBranchIds, activeGroupId };
    const assistantMessage = await this.callClaude(apiKey, messages, toolCtx, services, model);

    // Persist assistant message
    await this.db.insert(schema.aiChatMessages).values({
      id: randomUUID(),
      sessionId,
      role: 'assistant',
      content: assistantMessage,
    });

    // Update session title from first message if it's a new session
    let sessionTitle: string | undefined;
    if (!params.sessionId) {
      sessionTitle = userMessage.length > 60
        ? userMessage.slice(0, 57) + '...'
        : userMessage;
      await this.db
        .update(schema.aiChatSessions)
        .set({ title: sessionTitle, updatedAt: new Date() })
        .where(eq(schema.aiChatSessions.id, sessionId));
    } else {
      await this.db
        .update(schema.aiChatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(schema.aiChatSessions.id, sessionId));
    }

    return { sessionId, assistantMessage, sessionTitle };
  }

  private async callClaude(
    apiKey: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    toolCtx: ToolExecutorContext,
    services: ToolExecutorServices,
    model?: string,
  ): Promise<string> {
    // Dynamic import to avoid loading SDK when not needed
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const resolvedModel = model || 'claude-haiku-4-5-20251001';
    let currentMessages: any[] = [...messages];
    const maxToolRounds = 5;

    for (let round = 0; round < maxToolRounds; round++) {
      const response = await client.messages.create({
        model: resolvedModel,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: AI_TOOLS as any,
        messages: currentMessages,
      });

      // Check if we need to process tool calls
      const toolUseBlocks = response.content.filter(
        (block: any) => block.type === 'tool_use',
      );

      if (toolUseBlocks.length === 0) {
        // No tool calls — extract text response
        const textParts = response.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => (block as any).text as string);
        return textParts.join('\n') || 'I was unable to generate a response.';
      }

      // Execute tools and build tool_result messages
      const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];

      for (const toolBlock of toolUseBlocks) {
        const tb = toolBlock as any;
        const result = await executeTool(
          tb.name as string,
          tb.input as Record<string, unknown>,
          toolCtx,
          services,
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tb.id as string,
          content: result,
        });
      }

      // Append assistant response and tool results for next round
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ];
    }

    return 'I needed more steps to answer your question. Please try rephrasing or breaking your request into smaller parts.';
  }

  // ── Cron: Purge Old Chat Data ────────────────────────

  @Cron('0 30 3 * * *')
  async purgeOldChatData(): Promise<void> {
    const RETENTION_DAYS = 7;
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const deleted = await this.db
      .delete(schema.aiChatSessions)
      .where(lt(schema.aiChatSessions.updatedAt, cutoff))
      .returning({ id: schema.aiChatSessions.id });

    if (deleted.length > 0) {
      this.logger.log(`[ai-purge] Purged ${deleted.length} chat sessions older than ${RETENTION_DAYS} days`);
    }
  }
}
