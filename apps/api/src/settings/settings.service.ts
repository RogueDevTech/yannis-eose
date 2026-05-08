import { Injectable, Inject } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import { db as schema } from '@yannis/shared';
import { DRIZZLE, REDIS } from '../database/database.module';
import { withActor } from '../common/db/with-actor';

const REDIS_PREFIX = 'yannis:setting:';
const CACHE_TTL_SECONDS = 300; // 5 minutes

/**
 * Phase C — keys whose system_settings value is overridable per team.
 *
 * Each entry declares the key, a UI label/description, and which team
 * departments may override it. Settings not in this catalog can only be
 * set at the system level.
 */
export interface OverridableSettingDef {
  key: string;
  label: string;
  description: string;
  /** Which team departments may override this. */
  allowedDepartments: ReadonlyArray<'CS' | 'MARKETING'>;
}

export const OVERRIDABLE_TEAM_SETTINGS: ReadonlyArray<OverridableSettingDef> = [
  {
    key: 'CS_DISPATCH_STRATEGY',
    label: 'CS order distribution',
    description:
      'How new orders are assigned to agents in this team. Inherits the system value when no override is set.',
    allowedDepartments: ['CS'],
  },
  {
    key: 'CS_CLAIM_CAP',
    label: 'CS claim cap',
    description: 'Maximum unconfirmed orders an agent may hold under claim mode.',
    allowedDepartments: ['CS'],
  },
];

export type EffectiveSettingSource = 'enforced-system' | 'team' | 'system' | 'unset';

export interface EffectiveTeamSetting {
  key: string;
  /** Resolved value the runtime should use. */
  value: Record<string, unknown> | null;
  source: EffectiveSettingSource;
  /** True when system_settings.is_enforced was set, blocking team overrides. */
  systemEnforced: boolean;
  /** Raw system value (visible alongside the team override in the UI). */
  systemValue: Record<string, unknown> | null;
  /** Team override value if any. */
  teamValue: Record<string, unknown> | null;
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Get a system setting by key.
   * Checks Redis cache first, falls back to DB, then caches.
   */
  async get(key: string): Promise<Record<string, unknown> | null> {
    // Check Redis cache
    const cached = await this.redis.get(`${REDIS_PREFIX}${key}`);
    if (cached) {
      return JSON.parse(cached) as Record<string, unknown>;
    }

    // Fallback to DB
    const rows = await this.db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, key))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const value = row.value as Record<string, unknown>;

    // Cache in Redis
    await this.redis.set(
      `${REDIS_PREFIX}${key}`,
      JSON.stringify(value),
      'EX',
      CACHE_TTL_SECONDS,
    );

    return value;
  }

  /**
   * Get all system settings.
   */
  async getAll(): Promise<
    Array<{
      key: string;
      value: Record<string, unknown>;
      isEnforced: boolean;
      updatedBy: string | null;
      updatedAt: Date;
    }>
  > {
    const rows = await this.db.select().from(schema.systemSettings);

    return rows.map((row) => ({
      key: row.key,
      value: row.value as Record<string, unknown>,
      isEnforced: row.isEnforced,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * Upsert a system setting with audit trail. `isEnforced` is preserved when
   * not provided so existing call sites stay backward-compatible.
   */
  async set(
    key: string,
    value: Record<string, unknown>,
    actorId: string,
    isEnforced?: boolean,
  ): Promise<void> {
    await withActor(this.db, { id: actorId }, async (tx) => {
      const existing = await tx
        .select()
        .from(schema.systemSettings)
        .where(eq(schema.systemSettings.key, key))
        .limit(1);

      if (existing[0]) {
        const update: Record<string, unknown> = {
          value,
          updatedBy: actorId,
          updatedAt: new Date(),
        };
        if (isEnforced !== undefined) update.isEnforced = isEnforced;
        await tx
          .update(schema.systemSettings)
          .set(update)
          .where(eq(schema.systemSettings.key, key));
      } else {
        await tx
          .insert(schema.systemSettings)
          .values({
            key,
            value,
            isEnforced: isEnforced ?? false,
            updatedBy: actorId,
          });
      }
    });

    await this.redis.del(`${REDIS_PREFIX}${key}`);
  }

  /** Toggle the enforcement lock on a system setting. */
  async setEnforced(key: string, isEnforced: boolean, actorId: string): Promise<void> {
    await withActor(this.db, { id: actorId }, async (tx) => {
      await tx
        .update(schema.systemSettings)
        .set({ isEnforced, updatedBy: actorId, updatedAt: new Date() })
        .where(eq(schema.systemSettings.key, key));
    });
    await this.redis.del(`${REDIS_PREFIX}${key}`);
  }

  // ── Per-team overrides (Phase C) ───────────────────────────────────────

  /**
   * Resolve the effective value of a setting for a specific team.
   * Resolution order: enforced system > team override > system default.
   * Returns metadata so the UI can show all three layers.
   */
  async getEffectiveTeamSetting(teamId: string, key: string): Promise<EffectiveTeamSetting> {
    const [systemRow] = await this.db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, key))
      .limit(1);

    const [teamRow] = await this.db
      .select()
      .from(schema.branchTeamSettings)
      .where(
        and(
          eq(schema.branchTeamSettings.teamId, teamId),
          eq(schema.branchTeamSettings.key, key),
        ),
      )
      .limit(1);

    const systemValue = (systemRow?.value as Record<string, unknown>) ?? null;
    const teamValue = (teamRow?.value as Record<string, unknown>) ?? null;
    const systemEnforced = !!systemRow?.isEnforced;

    let value: Record<string, unknown> | null;
    let source: EffectiveSettingSource;
    if (systemEnforced && systemValue !== null) {
      value = systemValue;
      source = 'enforced-system';
    } else if (teamValue !== null) {
      value = teamValue;
      source = 'team';
    } else if (systemValue !== null) {
      value = systemValue;
      source = 'system';
    } else {
      value = null;
      source = 'unset';
    }

    return { key, value, source, systemEnforced, systemValue, teamValue };
  }

  /** All overridable settings for a single team — used by the team accordion UI. */
  async listTeamSettings(
    teamId: string,
    department: 'CS' | 'MARKETING',
  ): Promise<EffectiveTeamSetting[]> {
    const allowed = OVERRIDABLE_TEAM_SETTINGS.filter((def) =>
      def.allowedDepartments.includes(department),
    );
    if (allowed.length === 0) return [];
    return Promise.all(allowed.map((def) => this.getEffectiveTeamSetting(teamId, def.key)));
  }

  async setTeamSetting(
    teamId: string,
    key: string,
    value: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    await withActor(this.db, { id: actorId }, async (tx) => {
      const existing = await tx
        .select()
        .from(schema.branchTeamSettings)
        .where(
          and(
            eq(schema.branchTeamSettings.teamId, teamId),
            eq(schema.branchTeamSettings.key, key),
          ),
        )
        .limit(1);

      if (existing[0]) {
        await tx
          .update(schema.branchTeamSettings)
          .set({ value, updatedBy: actorId, updatedAt: new Date() })
          .where(eq(schema.branchTeamSettings.id, existing[0].id));
      } else {
        await tx
          .insert(schema.branchTeamSettings)
          .values({ teamId, key, value, updatedBy: actorId });
      }
    });
  }

  /** Remove a team override; the team falls back to the system value. */
  async clearTeamSetting(teamId: string, key: string, actorId: string): Promise<void> {
    await withActor(this.db, { id: actorId }, async (tx) => {
      await tx
        .delete(schema.branchTeamSettings)
        .where(
          and(
            eq(schema.branchTeamSettings.teamId, teamId),
            eq(schema.branchTeamSettings.key, key),
          ),
        );
    });
  }
}
