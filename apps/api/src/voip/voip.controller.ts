import {
  Controller,
  Post,
  Get,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { VoipService } from './voip.service';
import { Public } from '../common/decorators/public.decorator';

/**
 * VOIP Controller — handles Africa's Talking webhook callbacks and the voice-action XML
 * endpoint. Webhooks are public because AT POSTs to them directly; in production we should
 * verify the request originated from AT's IP range as a secondary signature.
 *
 * Routes:
 *   POST /voip/webhook/africas-talking     — AT lifecycle events (Queued/Ringing/Active/Completed/Failed)
 *   GET/POST /voip/voice/africas-talking   — AT voice action: bridges agent leg → customer
 */
@Controller('voip')
export class VoipController {
  constructor(private readonly voipService: VoipService) {}

  // ─── Africa's Talking voice action ────────────────────────────

  /**
   * AT calls this URL (configured in the AT app dashboard) when the agent's phone leg goes
   * active. We respond with `<Dial>` XML to bridge them to the customer. AT passes session
   * context as form fields including `clientRequestId` (which is our callToken) and looks up
   * the order's customer phone via the call_log → orders join.
   *
   * IMPORTANT: AT also calls this URL ON EVERY VOICE LEG EVENT (active, completed) — when the
   * `isActive` flag is "0" we return an empty Response so AT doesn't try to dial again.
   */
  @Public()
  @Get('voice/africas-talking')
  @Post('voice/africas-talking')
  @HttpCode(HttpStatus.OK)
  async voiceActionAfricasTalking(@Req() req: Request, @Res() res: Response) {
    const body = (req.body as Record<string, string>) ?? {};
    const query = req.query as Record<string, string>;
    const isActive = body['isActive'] ?? query['isActive'] ?? '';
    const clientRequestId = body['clientRequestId'] ?? query['clientRequestId'] ?? '';

    res.setHeader('Content-Type', 'application/xml');

    // Only respond with Dial XML on the FIRST hit (when AT is asking what to do as the agent
    // picks up). Subsequent hits (call ended, etc.) get an empty 200.
    if (isActive !== '1' || !clientRequestId) {
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
      return;
    }

    try {
      const customerPhone = await this.voipService.lookupCustomerPhoneByCallToken(clientRequestId);
      if (!customerPhone) {
        res.send(
          '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="woman">No phone number on file. Goodbye.</Say><Reject/></Response>',
        );
        return;
      }
      // Phone-to-phone bridge. `record="true"` enables call recording (subject to AT plan).
      // `callerId` is the AT phone number — fall back to default if env not set.
      const callerId = process.env['AT_PHONE_NUMBER'] ?? '';
      const callerIdAttr = callerId ? ` callerId="${callerId}"` : '';
      res.send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Dial phoneNumbers="${escapeXml(customerPhone)}" record="true"${callerIdAttr} /></Response>`,
      );
    } catch (error) {
      console.error("[VoipController] AT voice action error:", error);
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>System error. Please try again.</Say><Reject/></Response>');
    }
  }

  // ─── Africa's Talking event webhook ───────────────────────────

  /**
   * AT posts call lifecycle events (Queued / Ringing / Active / Completed / Failed) here.
   * Body fields we care about: `clientRequestId` (our callToken), `status`, `durationInSeconds`.
   * AT returns durations in seconds for `Completed` events.
   */
  @Public()
  @Post('webhook/africas-talking')
  @HttpCode(HttpStatus.OK)
  async handleAfricasTalkingWebhook(@Req() req: Request) {
    const body = (req.body as Record<string, string>) ?? {};
    const callToken = body['clientRequestId'] ?? '';
    const status = body['status'] ?? '';
    const durationStr = body['durationInSeconds'] ?? body['callerCountryCode'] /* fallback unused */;

    if (!callToken || !status) {
      return { received: false, message: 'Missing clientRequestId or status' };
    }

    const duration = durationStr && /^\d+$/.test(durationStr) ? parseInt(durationStr, 10) : undefined;

    try {
      await this.voipService.handleWebhookStatusUpdate(callToken, status, duration, 'africas_talking');
      return { received: true };
    } catch (error) {
      console.error("[VoipController] AT webhook error:", error);
      return { received: false, message: 'Processing error' };
    }
  }
}

/** Minimal XML escape for the customer phone embedded in the Dial XML response. */
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
