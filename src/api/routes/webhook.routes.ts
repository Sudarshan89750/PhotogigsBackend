import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { PhonePeService } from '../../services/phonepe.service';
import logger from '../../utils/logger';

import { SubscriptionService } from '../../services/subscription.service';

const router = Router();

export default (app: Router): void => {
  app.use('/webhooks', router);
  const phonepe = Container.get(PhonePeService);
  const subSvc = Container.get(SubscriptionService);

  /**
   * PhonePe webhook — PRIMARY source of truth for payment state.
   *
   * PhonePe POSTs base64-encoded payload + X-VERIFY header here when
   * a payment transitions to COMPLETED, FAILED, or CANCELLED.
   *
   * WHY this must be primary:
   *   If a user pays and closes the browser tab before the frontend redirect
   *   fires /verify-payment, the order/job will be stuck in draft/pending
   *   forever. The webhook is the only reliable signal from PhonePe.
   *
   * IDEMPOTENCY:
   *   Services use findOneAndUpdate with status guards so re-delivering
   *   the same webhook event is safe (no double-transitions).
   */
  router.post('/phonepe', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { response } = req.body;
      const signature = req.headers['x-verify'] as string;

      if (!response || !signature) {
        res.status(400).json({ received: false });
        return;
      }

      const valid = phonepe.verifyWebhookSignature(response, signature);
      if (!valid) {
        logger.warn('PhonePe webhook: signature mismatch — possible replay attack');
        res.status(400).json({ received: false });
        return;
      }

      let decoded: any;
      try {
        decoded = JSON.parse(Buffer.from(response, 'base64').toString('utf-8'));
      } catch {
        logger.error('PhonePe webhook: failed to decode payload');
        res.status(400).json({ received: false });
        return;
      }

      const { merchantTransactionId, state } = decoded?.data ?? {};

      logger.info('PhonePe webhook received', { merchantTransactionId, state });

      // FIX: Actively resolve payment state — the webhook IS the source of truth.
      if (state === 'COMPLETED' && merchantTransactionId) {
        await resolvePayment(merchantTransactionId, subSvc).catch(err =>
          logger.error('Webhook payment resolution failed', { merchantTransactionId, err })
        );
      } else if (state === 'FAILED' && merchantTransactionId) {
        logger.warn('PhonePe payment FAILED', { merchantTransactionId });
        // Optionally: mark the draft job/order as payment_failed so the UI can prompt retry
        await markPaymentFailed(merchantTransactionId).catch(err =>
          logger.error('Webhook failure marking failed', { merchantTransactionId, err })
        );
      }

      // Always ACK to PhonePe — non-200 causes them to retry aggressively
      res.json({ received: true });
    } catch (e) { next(e); }
  });
};

/**
 * Resolves a completed payment against PostgreSQL for Subscriptions and Addons.
 */
async function resolvePayment(merchantTransactionId: string, subSvc: any): Promise<void> {
  if (merchantTransactionId.startsWith('SUB_')) {
    await subSvc.verifySubscriptionPayment(merchantTransactionId);
    logger.info('Webhook: Subscription processed', { merchantTransactionId });
    return;
  }

  if (merchantTransactionId.startsWith('ADDON_')) {
    await subSvc.verifyAddonPayment(merchantTransactionId);
    logger.info('Webhook: Addon processed', { merchantTransactionId });
    return;
  }

  logger.warn('Webhook: Unknown transaction prefix', { merchantTransactionId });
}

/**
 * Marks a failed payment.
 */
async function markPaymentFailed(merchantTransactionId: string): Promise<void> {
  const db = Container.get<any>('pgPool');
  
  if (merchantTransactionId.startsWith('SUB_')) {
    await db.query(`UPDATE subscriptions SET status = 'failed' WHERE phonepe_txn_id = $1 AND status = 'pending'`, [merchantTransactionId]);
    return;
  }
  
  if (merchantTransactionId.startsWith('ADDON_')) {
    await db.query(`UPDATE addon_purchases SET status = 'failed' WHERE phonepe_txn_id = $1 AND status = 'pending'`, [merchantTransactionId]);
    return;
  }
}

