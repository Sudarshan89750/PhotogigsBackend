import { Service, Inject } from 'typedi';
import crypto from 'crypto';
import { config } from '../config';
import logger from '../utils/logger';

export interface PhonePeOrderResult {
  transactionId: string;
  redirectUrl: string;
  amount: number;
}

export interface FeeBreakdown {
  subtotal: number;
  platformFee: number;
  total: number;
  freelancerPayout: number;
}

@Service()
export class PhonePeService {
  constructor(
    @Inject('logger') private logger: any
  ) {}
  /**
   * Initiates a PhonePe payment and returns redirect URL.
   * PhonePe Standard Checkout uses SHA256 HMAC of base64-encoded payload.
   */
  async initiatePayment(opts: {
    amount: number;           // in rupees
    transactionId: string;
    userId: string;
    redirectUrl?: string;
  }): Promise<PhonePeOrderResult> {
    const amountPaise = Math.round(opts.amount * 100);

    const payload = {
      merchantId: config.phonepe.merchantId,
      merchantTransactionId: opts.transactionId,
      merchantUserId: `PGUSER_${opts.userId}`,
      amount: amountPaise,
      redirectUrl: opts.redirectUrl ?? config.phonepe.redirectUrl,
      redirectMode: 'REDIRECT',
      callbackUrl: config.phonepe.callbackUrl,
      paymentInstrument: { type: 'PAY_PAGE' },
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const checksum = this.computeChecksum(base64Payload, '/pg/v1/pay');

    const response = await fetch(`${config.phonepe.baseUrl}/pg/v1/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': checksum,
      },
      body: JSON.stringify({ request: base64Payload }),
    });

    const data = (await response.json()) as any;

    if (!data.success) {
      if (config.env === 'development' || !config.isProduction) {
        logger.warn('PhonePe initiate failed. Mocking payment for DEV mode.', { message: data.message });
        return {
          transactionId: opts.transactionId,
          amount: opts.amount,
          redirectUrl: opts.redirectUrl ?? config.phonepe.redirectUrl
        };
      }
      logger.error('PhonePe initiate failed', { data });
      throw new Error(data.message ?? 'Payment initiation failed');
    }

    const redirectUrl: string = data.data.instrumentResponse.redirectInfo.url;

    return {
      transactionId: opts.transactionId,
      redirectUrl,
      amount: opts.amount,
    };
  }

  /**
   * Verifies payment status via PhonePe status API.
   * Call this from webhook or redirect callback.
   */
  async verifyPayment(transactionId: string): Promise<boolean> {
    if (config.env === 'development' || !config.isProduction) {
      this.logger.info('Auto-verifying payment in development mode', { transactionId });
      return true;
    }

    const path = `/pg/v1/status/${config.phonepe.merchantId}/${transactionId}`;
    const checksum = this.computeChecksum('', path);

    const response = await fetch(`${config.phonepe.baseUrl}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': checksum,
        'X-MERCHANT-ID': config.phonepe.merchantId,
      },
    });

    const data = (await response.json()) as any;
    return data.success === true && data.data?.state === 'COMPLETED';
  }

  /**
   * Initiates a refund via PhonePe.
   */
  async initiateRefund(opts: {
    originalTransactionId: string;
    refundTransactionId: string;
    amount: number; // rupees
  }): Promise<boolean> {
    const amountPaise = Math.round(opts.amount * 100);

    const payload = {
      merchantId: config.phonepe.merchantId,
      merchantUserId: `PGREFUND_${opts.refundTransactionId}`,
      originalTransactionId: opts.originalTransactionId,
      merchantTransactionId: opts.refundTransactionId,
      amount: amountPaise,
      callbackUrl: config.phonepe.callbackUrl,
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const checksum = this.computeChecksum(base64Payload, '/pg/v1/refund');

    const response = await fetch(`${config.phonepe.baseUrl}/pg/v1/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': checksum,
      },
      body: JSON.stringify({ request: base64Payload }),
    });

    const data = (await response.json()) as any;
    if (!data.success) {
      logger.error('PhonePe refund failed', { data });
      return false;
    }
    return true;
  }

  /** Verify webhook callback signature from PhonePe */
  verifyWebhookSignature(base64Response: string, receivedChecksum: string): boolean {
    const expected = this.computeChecksum(base64Response, '/pg/v1/pay');
    return expected === receivedChecksum;
  }

  computeFees(budget: number): FeeBreakdown {
    const platformFee = parseFloat(
      ((budget * config.platform.feePercent) / 100).toFixed(2)
    );
    return {
      subtotal: budget,
      platformFee,
      total: budget,                          // client pays budget, platform takes fee from payout
      freelancerPayout: budget - platformFee,
    };
  }

  private computeChecksum(base64Body: string, apiPath: string): string {
    const data = base64Body + apiPath + config.phonepe.apiKey;
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    return `${sha256}###${config.phonepe.apiKeyIndex}`;
  }
}
