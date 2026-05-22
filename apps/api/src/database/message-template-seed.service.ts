import { Injectable, Inject, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type postgres from 'postgres';
import { DEFAULT_MESSAGE_TEMPLATES } from '@yannis/shared';
import { PG_CLIENT } from './database.tokens';

/**
 * Auto-seed CS message templates on application bootstrap.
 *
 * Mirrors `PermissionSeedService` — runs in the background after the API
 * listener opens, idempotent, soft-fails. Each entry in
 * `DEFAULT_MESSAGE_TEMPLATES` (declared in `@yannis/shared`) is INSERT-ed
 * if no row with the same `name` already exists; existing rows are NEVER
 * touched (so HoCS-edited copy is preserved).
 *
 * Templates are seeded with `branch_id = NULL` (org-wide). The
 * `messaging.templates.list` tRPC procedure surfaces NULL-branch templates
 * to all Sales reps regardless of their session branch.
 *
 * `created_by` is required by the schema (FK → users). On a brand-new
 * deploy where no SuperAdmin exists yet, this seeder no-ops gracefully and
 * runs again on the next boot after `/auth/setup` completes.
 *
 * Skip with `MESSAGE_TEMPLATE_SEED_AUTORUN=false` (e.g. for tests).
 */
@Injectable()
export class MessageTemplateSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MessageTemplateSeedService.name);

  constructor(@Inject(PG_CLIENT) private readonly sql: ReturnType<typeof postgres>) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env['MESSAGE_TEMPLATE_SEED_AUTORUN'] === 'false') {
      this.logger.log('MESSAGE_TEMPLATE_SEED_AUTORUN=false — skipping default template sync.');
      return;
    }
    const blocking = process.env['MESSAGE_TEMPLATE_SEED_BLOCKING'] === 'true';
    const work = this.runSync();
    if (blocking) {
      await work;
      return;
    }
    void work;
  }

  private async runSync(): Promise<void> {
    const startedAt = Date.now();
    try {
      // Find a SuperAdmin to attribute the seeded templates to. On first boot
      // before /auth/setup runs there's nobody — no-op and retry next boot.
      const owners = await this.sql<{ id: string }[]>`
        SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' LIMIT 1
      `;
      const ownerId = owners[0]?.id;
      if (!ownerId) {
        this.logger.log(
          'No SUPER_ADMIN user found yet — message template seed skipped (will retry on next boot after /auth/setup).',
        );
        return;
      }

      let inserted = 0;
      let updated = 0;
      for (const template of DEFAULT_MESSAGE_TEMPLATES) {
        const existing = await this.sql<{ id: string; body: string }[]>`
          SELECT id, body FROM message_templates
          WHERE name = ${template.name} AND branch_id IS NULL
          LIMIT 1
        `;
        if (existing[0]) {
          // Update the body when the catalog version has changed (e.g. new
          // placeholders or formatting). Org-wide defaults are code-managed;
          // branch-level overrides (branch_id IS NOT NULL) are untouched.
          if (existing[0].body !== template.body) {
            await this.sql`
              UPDATE message_templates
              SET body = ${template.body}
              WHERE id = ${existing[0].id}::uuid
            `;
            updated += 1;
          }
          continue;
        }
        await this.sql`
          INSERT INTO message_templates (id, name, channel, body, created_by, branch_id, status)
          VALUES (
            gen_random_uuid(),
            ${template.name},
            ${template.channel}::message_channel,
            ${template.body},
            ${ownerId}::uuid,
            NULL,
            'ACTIVE'::template_status
          )
        `;
        inserted += 1;
      }

      const ms = Date.now() - startedAt;
      this.logger.log(
        `Default message templates synced in ${ms}ms (${inserted} new, ${updated} updated, ${DEFAULT_MESSAGE_TEMPLATES.length - inserted - updated} unchanged).`,
      );
    } catch (err) {
      // Soft fail — existing rows still work, agents can use them as-is.
      this.logger.error(
        `Default message template sync failed: ${err instanceof Error ? err.message : String(err)}. ` +
          'API continues with whatever rows are already in the DB.',
      );
    }
  }
}
