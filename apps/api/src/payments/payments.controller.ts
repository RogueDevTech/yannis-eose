import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PaystackService } from './paystack.service';
import { OrdersService } from '../orders/orders.service';
import type { Request, Response } from 'express';

@Controller()
export class PaymentsController {
  constructor(
    private readonly paystackService: PaystackService,
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * Payment callback: Paystack redirects here with ?reference=xxx.
   * Verifies the transaction and redirects to thank-you or error page.
   */
  @Public()
  @Get('payments/complete')
  async complete(
    @Query('reference') reference: string | undefined,
    @Query('trxref') trxref: string | undefined,
    @Res() res: Response,
  ) {
    const thankYouBase = process.env.PAYSTACK_CALLBACK_BASE_URL || process.env.APP_URL || 'http://localhost:4003';
    const thankYouUrl = `${thankYouBase.replace(/\/$/, '')}/payment/thank-you`;
    const errorUrl = `${thankYouBase.replace(/\/$/, '')}/payment/error`;

    const ref = (reference ?? trxref)?.trim();
    if (!ref) {
      res.redirect(302, errorUrl + '?reason=missing_reference');
      return;
    }

    const result = await this.ordersService.completePaymentByReference(ref);
    if (result?.success) {
      res.redirect(302, thankYouUrl + '?orderId=' + encodeURIComponent(result.orderId));
      return;
    }

    res.redirect(302, errorUrl + '?reason=verification_failed');
  }

  /**
   * Paystack webhook: charge.success (and optionally charge.failed).
   * Verify signature then verify transaction and mark order PAID.
   */
  @Public()
  @Post('webhooks/paystack')
  async webhook(@Req() req: Request, @Res() res: Response) {
    const body = req.body as Record<string, unknown> | undefined;
    const payload = body !== undefined ? JSON.stringify(body) : '';
    const signature = req.headers['x-paystack-signature'] as string | undefined;

    if (!signature || !this.paystackService.verifyWebhookSignature(payload, signature)) {
      res.status(401).json({ received: true });
      return;
    }

    const data = body as { event?: string; data?: { reference?: string } };
    if (data.event === 'charge.success' && data.data?.reference) {
      await this.ordersService.completePaymentByReference(data.data.reference);
    }

    res.status(200).json({ received: true });
  }
}
