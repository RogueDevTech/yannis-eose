import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  db as schema,
  DUPLICATE_RULES_SETTING_KEY,
  resolveDuplicateRules,
  type DuplicateRules,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { SettingsService } from './settings.service';

/** branch → company lookups change only when a branch moves company. */
const BRANCH_GROUP_TTL_MS = 5 * 60 * 1000;
/**
 * Resolved rules per company, in process. SettingsService.get only caches rows
 * that exist, so without this every order-form submit for a company with no
 * saved row (every company today) would pay a DB read. Saving through
 * settings.updateDuplicateRules calls invalidate(); other instances pick the
 * change up within this TTL.
 */
const RULES_TTL_MS = 60 * 1000;

/**
 * Per-company duplicate rules (system setting DUPLICATE_RULES).
 *
 * FAIL-SAFE BY CONTRACT: every method returns today's defaults on any error.
 * Resolved rules are memoised per company for RULES_TTL_MS (missing rows
 * included), so the per-call cost on the order form is an in-memory hit.
 */
@Injectable()
export class DuplicateRulesService {
  private readonly logger = new Logger(DuplicateRulesService.name);
  private readonly branchGroup = new Map<string, { groupId: string | null; at: number }>();
  private readonly rulesByGroup = new Map<string, { rules: DuplicateRules; at: number }>();
  private groupIds: { ids: string[]; at: number } | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
  ) {}

  /** Rules for a company. A null company (legacy data) gets the defaults. */
  async forGroup(groupId: string | null | undefined): Promise<DuplicateRules> {
    if (!groupId) return resolveDuplicateRules(null);
    const hit = this.rulesByGroup.get(groupId);
    if (hit && Date.now() - hit.at < RULES_TTL_MS) return hit.rules;
    try {
      const rules = resolveDuplicateRules(await this.settings.get(DUPLICATE_RULES_SETTING_KEY, groupId));
      this.rulesByGroup.set(groupId, { rules, at: Date.now() });
      return rules;
    } catch (err) {
      this.logger.warn(`Duplicate rules read failed for group ${groupId}, using defaults: ${(err as Error)?.message ?? err}`);
      return resolveDuplicateRules(null);
    }
  }

  /** Rules for the company that owns a branch. */
  async forBranch(branchId: string | null | undefined): Promise<DuplicateRules> {
    if (!branchId) return resolveDuplicateRules(null);
    try {
      return this.forGroup(await this.groupOfBranch(branchId));
    } catch (err) {
      this.logger.warn(`Duplicate rules branch lookup failed for ${branchId}, using defaults: ${(err as Error)?.message ?? err}`);
      return resolveDuplicateRules(null);
    }
  }

  /**
   * Rules for many branches at once, for crons that sweep every company.
   * Unknown branches (and a null branch) map to the defaults.
   */
  async forBranches(branchIds: Array<string | null | undefined>): Promise<(branchId: string | null | undefined) => DuplicateRules> {
    const fallback = resolveDuplicateRules(null);
    const byBranch = new Map<string, DuplicateRules>();
    try {
      const ids = [...new Set(branchIds.filter((b): b is string => !!b))];
      if (ids.length > 0) {
        const rows = await this.db
          .select({ id: schema.branches.id, groupId: schema.branches.groupId })
          .from(schema.branches)
          .where(inArray(schema.branches.id, ids));
        const byGroup = new Map<string, DuplicateRules>();
        for (const row of rows) {
          if (!row.groupId) continue;
          let rules = byGroup.get(row.groupId);
          if (!rules) {
            rules = await this.forGroup(row.groupId);
            byGroup.set(row.groupId, rules);
          }
          byBranch.set(row.id, rules);
        }
      }
    } catch (err) {
      this.logger.warn(`Duplicate rules bulk lookup failed, using defaults: ${(err as Error)?.message ?? err}`);
    }
    return (branchId) => (branchId ? byBranch.get(branchId) : undefined) ?? fallback;
  }

  /**
   * Every company's rules, plus the defaults, for crons whose SQL needs one
   * row per company (e.g. a per-company window). Companies without a row use
   * the defaults via `fallback`.
   */
  async allCompanies(): Promise<{ byGroup: Map<string, DuplicateRules>; fallback: DuplicateRules }> {
    const fallback = resolveDuplicateRules(null);
    const byGroup = new Map<string, DuplicateRules>();
    try {
      if (!this.groupIds || Date.now() - this.groupIds.at >= BRANCH_GROUP_TTL_MS) {
        const groups = await this.db.select({ id: schema.branchGroups.id }).from(schema.branchGroups);
        this.groupIds = { ids: groups.map((g) => g.id), at: Date.now() };
      }
      const resolved = await Promise.all(this.groupIds.ids.map((id) => this.forGroup(id)));
      this.groupIds.ids.forEach((id, i) => byGroup.set(id, resolved[i]!));
    } catch (err) {
      this.logger.warn(`Duplicate rules company sweep failed, using defaults: ${(err as Error)?.message ?? err}`);
    }
    return { byGroup, fallback };
  }

  /** Drop a company's memoised rules (called after a save). */
  invalidate(groupId: string | null | undefined): void {
    if (groupId) this.rulesByGroup.delete(groupId);
  }

  private async groupOfBranch(branchId: string): Promise<string | null> {
    const hit = this.branchGroup.get(branchId);
    if (hit && Date.now() - hit.at < BRANCH_GROUP_TTL_MS) return hit.groupId;
    const [row] = await this.db
      .select({ groupId: schema.branches.groupId })
      .from(schema.branches)
      .where(eq(schema.branches.id, branchId))
      .limit(1);
    const groupId = row?.groupId ?? null;
    this.branchGroup.set(branchId, { groupId, at: Date.now() });
    return groupId;
  }
}
