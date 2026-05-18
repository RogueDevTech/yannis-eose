import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { NotificationsService } from './notifications.service';
import { pushAckSchema } from '@yannis/shared';

/**
 * PushController — lightweight REST endpoint consumed by the Service Worker.
 *
 * POST /push/ack
 *   Called from the service worker (or client JS) when a push notification is
 *   shown or clicked. Updates the push_delivery_log record.
 *   Marked @Public() because the service worker context has no session cookie.
 */
@Controller('push')
export class PushController {
  constructor(private readonly notifications: NotificationsService) {}

  @Public()
  @Post('ack')
  @HttpCode(200)
  async ack(@Body() body: unknown): Promise<{ ok: boolean }> {
    const parsed = pushAckSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false };
    }

    await this.notifications.ackPush(parsed.data.logId, parsed.data.event);
    return { ok: true };
  }
}
