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
 * VOIP Controller — handles Twilio webhook callbacks and TwiML App Voice Request URL.
 * These endpoints are public because Twilio calls them directly.
 * In production, Twilio request signature validation should be added.
 */
@Controller('voip')
export class VoipController {
  constructor(private readonly voipService: VoipService) {}

  /**
   * TwiML App "Voice Request URL" — Twilio calls this when a Twilio Client (browser) places
   * an outbound call or when an incoming call hits your Twilio number.
   * Accepts GET or POST so it works whether Twilio is set to GET or POST in the TwiML App.
   */
  @Public()
  @Get('voice')
  @Post('voice')
  @HttpCode(HttpStatus.OK)
  voiceTwiML(@Req() _req: Request, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/xml');
    res.send(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting your call.</Say></Response>',
    );
  }

  /**
   * Twilio StatusCallback webhook.
   * Receives call status updates (initiated, ringing, in-progress, completed, etc.).
   *
   * Twilio sends form-urlencoded data with fields:
   *   CallSid, CallStatus, CallDuration, etc.
   *
   * The callToken is passed as a query parameter on the StatusCallback URL.
   */
  @Public()
  @Post('webhook/status')
  @HttpCode(HttpStatus.OK)
  async handleStatusWebhook(@Req() req: Request) {
    const callToken = (req.query['callToken'] as string) ?? '';
    const callStatus = (req.body as Record<string, string>)?.['CallStatus'] ?? '';
    const callDuration = (req.body as Record<string, string>)?.['CallDuration'];

    if (!callToken || !callStatus) {
      return { received: false, message: 'Missing callToken or CallStatus' };
    }

    const duration = callDuration ? parseInt(callDuration, 10) : undefined;

    try {
      await this.voipService.handleWebhookStatusUpdate(callToken, callStatus, duration);
      return { received: true };
    } catch (error) {
      // Return 200 to Twilio even on errors to prevent retries
      // Log the error for debugging
      console.error('[VoipController] Webhook error:', error);
      return { received: false, message: 'Processing error' };
    }
  }
}
