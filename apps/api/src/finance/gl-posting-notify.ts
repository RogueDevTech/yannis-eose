import { Logger } from '@nestjs/common';
import type { NotificationsService } from '../notifications/notifications.service';

export type GlPostingResult = { posted: boolean; reason?: string };

/**
 * Run a non-fatal GL post and notify Finance when accounting is enabled but
 * posting fails (missing COA, closed fiscal year, etc.).
 */
export async function runGlPostWithFinanceAlert(
  notifications: NotificationsService,
  logger: Logger,
  source: string,
  entityId: string,
  fn: () => Promise<GlPostingResult>,
): Promise<void> {
  try {
    const res = await fn();
    if (!res.posted && res.reason && res.reason !== 'already-posted') {
      logger.warn(`${source} GL not posted for ${entityId}: ${res.reason}`);
      enqueueGlPostingFailureAlert(notifications, { source, entityId, reason: res.reason });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`${source} GL posting for ${entityId} failed: ${msg}`);
    enqueueGlPostingFailureAlert(notifications, { source, entityId, reason: msg });
  }
}

export function enqueueGlPostingFailureAlert(
  notifications: NotificationsService,
  detail: { source: string; entityId: string; reason: string },
): void {
  const reason = detail.reason.slice(0, 500);
  const body = `${detail.source} (${detail.entityId.slice(0, 8)}…): ${reason}`;
  notifications.enqueueCreateForRole('FINANCE_OFFICER', {
    type: 'finance:gl_posting_failed',
    title: 'Ledger posting failed',
    body,
    data: {
      source: detail.source,
      entityId: detail.entityId,
    },
  });
}
