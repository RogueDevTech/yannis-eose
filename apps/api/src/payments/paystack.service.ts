import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

const PAYSTACK_BASE = 'https://api.paystack.co';

export interface InitializeTransactionParams {
  email: string;
  amountInKobo: number;
  reference?: string;
  callbackUrl: string;
  metadata?: Record<string, string>;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  reference: string;
  accessCode: string;
}

export interface VerifyTransactionResult {
  status: 'success' | 'failed';
  amount: number; // in kobo
  reference: string;
}

@Injectable()
export class PaystackService {
  private readonly secretKey: string | undefined;

  constructor() {
    this.secretKey = process.env.PAYSTACK_SECRET_KEY;
  }

  isConfigured(): boolean {
    return Boolean(this.secretKey && this.secretKey.length > 0);
  }

  /**
   * Initialize a Paystack transaction. Returns the URL to redirect the customer to.
   */
  async initializeTransaction(params: InitializeTransactionParams): Promise<InitializeTransactionResult | null> {
    if (!this.isConfigured()) {
      return null;
    }
    const body = {
      email: params.email,
      amount: params.amountInKobo,
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata ?? {},
    };
    const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      status?: boolean;
      data?: { authorization_url?: string; reference?: string; access_code?: string };
      message?: string;
    };
    if (!res.ok || !data.status || !data.data?.authorization_url) {
      return null;
    }
    return {
      authorizationUrl: data.data.authorization_url,
      reference: data.data.reference ?? params.reference ?? '',
      accessCode: data.data.access_code ?? '',
    };
  }

  /**
   * Verify a transaction by reference. Use after redirect or in webhook.
   */
  async verifyTransaction(reference: string): Promise<VerifyTransactionResult | null> {
    if (!this.isConfigured()) {
      return null;
    }
    const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
      },
    });
    const data = (await res.json()) as {
      status?: boolean;
      data?: { status?: string; amount?: number; reference?: string };
    };
    if (!res.ok || !data.status || !data.data) {
      return null;
    }
    const status = data.data.status === 'success' ? 'success' : 'failed';
    return {
      status,
      amount: data.data.amount ?? 0,
      reference: data.data.reference ?? reference,
    };
  }

  /**
   * Verify webhook signature (x-paystack-signature) using raw body and secret.
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.secretKey) return false;
    const hash = crypto.createHmac('sha512', this.secretKey).update(payload).digest('hex');
    // Use timingSafeEqual to prevent timing attacks on HMAC comparison
    if (hash.length !== signature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(signature, 'hex'));
  }
}
