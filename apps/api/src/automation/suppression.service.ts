import { Injectable, Inject } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, isNull, or, inArray } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import type { AutomationChannel } from './channels/channel-provider.interface';

type Drizzle = PostgresJsDatabase<typeof schema>;

/**
 * The customer opt-out / do-not-contact list. Checked before every automation
 * send. Identity is the phone hash (SMS/WhatsApp) or email (email) — there is no
 * customers table. A suppression row scoped to `ALL` blocks every channel.
 */
@Injectable()
export class SuppressionService {
  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  /**
   * Is this recipient suppressed for the given channel? Matches when a row exists
   * for the phone-hash OR email, with channel = the requested channel or `ALL`.
   * Only current rows (valid_to IS NULL) count.
   */
  async isSuppressed(params: {
    channel: AutomationChannel;
    phoneHash?: string | null;
    email?: string | null;
  }): Promise<boolean> {
    const { channel, phoneHash, email } = params;
    if (!phoneHash && !email) return false;

    const identityMatches = [
      phoneHash ? eq(schema.messageSuppressions.customerPhoneHash, phoneHash) : undefined,
      email ? eq(schema.messageSuppressions.customerEmail, email) : undefined,
    ].filter(Boolean) as ReturnType<typeof eq>[];

    const rows = await this.db
      .select({ id: schema.messageSuppressions.id })
      .from(schema.messageSuppressions)
      .where(
        and(
          isNull(schema.messageSuppressions.validTo),
          inArray(schema.messageSuppressions.channel, [channel, 'ALL']),
          or(...identityMatches),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  /** Add a suppression (unsubscribe, bounce, manual do-not-contact). */
  async add(
    input: {
      phoneHash?: string | null;
      email?: string | null;
      channel?: 'EMAIL' | 'SMS' | 'WHATSAPP' | 'ALL';
      reason?: 'UNSUBSCRIBED' | 'BOUNCED' | 'COMPLAINED' | 'MANUAL';
      note?: string;
      groupId?: string | null;
    },
    actorId: string,
  ) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .insert(schema.messageSuppressions)
        .values({
          customerPhoneHash: input.phoneHash ?? null,
          customerEmail: input.email ?? null,
          channel: input.channel ?? 'ALL',
          reason: input.reason ?? 'MANUAL',
          note: input.note ?? null,
          groupId: input.groupId ?? null,
        })
        .returning();
      return rows[0];
    });
  }
}
