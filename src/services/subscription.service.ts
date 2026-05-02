import { Service, Inject, Container } from 'typedi';
import { v4 as uuidv4 } from 'uuid';
import { PhonePeService } from './phonepe.service';
import { NotificationService } from './notification.service';
import { NotFoundError, BadRequestError } from '../utils/errors';

@Service()
export class SubscriptionService {
  private phonepe: PhonePeService;
  private notif: NotificationService;

  constructor(
    @Inject('pgPool') private db: any,
    @Inject('logger') private logger: any
  ) {
    this.phonepe = Container.get(PhonePeService);
    this.notif = Container.get(NotificationService);
  }

  async getPlans() {
    const { rows } = await this.db.query(
      `SELECT * FROM membership_plans WHERE is_active = true ORDER BY price ASC`
    );
    return rows;
  }

  async getSubscription(userId: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 AND status IN ('trialing', 'active') LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  }

  async createSubscriptionPayment(userId: string, planId: string) {
    const { rows: planRows } = await this.db.query(
      `SELECT * FROM membership_plans WHERE id = $1 AND is_active = true`,
      [planId]
    );

    if (!planRows[0]) throw new NotFoundError('Plan not found');
    const plan = planRows[0];

    const transactionId = `SUB_${uuidv4().replace(/-/g, '')}`;

    await this.db.query(
      `INSERT INTO subscriptions (user_id, plan_id, status, phonepe_txn_id)
       VALUES ($1, $2, 'pending', $3)`,
      [userId, planId, transactionId]
    );

    const paymentOrder = await this.phonepe.initiatePayment({
      amount: plan.price,
      transactionId,
      userId,
    });

    return paymentOrder;
  }

  async verifySubscriptionPayment(transactionId: string) {
    const paid = await this.phonepe.verifyPayment(transactionId);
    if (!paid) throw new BadRequestError('Payment not completed');

    const { rows: subRows } = await this.db.query(
      `SELECT s.*, p.trial_duration_days 
       FROM subscriptions s 
       JOIN membership_plans p ON s.plan_id = p.id
       WHERE s.phonepe_txn_id = $1 AND s.status = 'pending'`,
      [transactionId]
    );

    if (!subRows[0]) throw new NotFoundError('Subscription record not found or already processed');
    const sub = subRows[0];
    const userId = sub.user_id;

    // Default to a 30-day billing cycle for the plan
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await this.db.query('BEGIN');
    try {
      await this.db.query(
        `UPDATE subscriptions SET status = 'active', expires_at = $1 WHERE id = $2`,
        [expiresAt, sub.id]
      );

      await this.db.query(
        `UPDATE users SET membership_tier = 'pro' WHERE id = $1`,
        [userId]
      );

      await this.notif.create({
        userId,
        type: 'subscription_active',
        title: 'Subscription Active',
        body: 'Welcome to Pro! Your subscription is now active.',
        referenceId: String(sub.id),
        referenceType: 'subscription',
      });

      await this.db.query('COMMIT');
    } catch (e) {
      await this.db.query('ROLLBACK');
      throw e;
    }

    return { success: true };
  }

  async purchaseAddon(userId: string, quantity: number) {
    const pricePerUnit = 50; // Example price per 1 image unit, adjust as necessary
    const amount = quantity * pricePerUnit;

    const transactionId = `ADDON_${uuidv4().replace(/-/g, '')}`;

    await this.db.query(
      `INSERT INTO addon_purchases (user_id, quantity_granted, phonepe_txn_id, status)
       VALUES ($1, $2, $3, 'pending')`,
      [userId, quantity, transactionId]
    );

    const paymentOrder = await this.phonepe.initiatePayment({
      amount,
      transactionId,
      userId,
    });

    return paymentOrder;
  }

  async verifyAddonPayment(transactionId: string) {
    const paid = await this.phonepe.verifyPayment(transactionId);
    if (!paid) throw new BadRequestError('Payment not completed');

    const { rows: addonRows } = await this.db.query(
      `SELECT * FROM addon_purchases WHERE phonepe_txn_id = $1 AND status = 'pending'`,
      [transactionId]
    );

    if (!addonRows[0]) throw new NotFoundError('Addon purchase not found or already processed');
    const addon = addonRows[0];
    const userId = addon.user_id;

    await this.db.query('BEGIN');
    try {
      await this.db.query(
        `UPDATE addon_purchases SET status = 'completed' WHERE id = $1`,
        [addon.id]
      );

      await this.db.query(
        `UPDATE users SET addon_image_limit = addon_image_limit + $1 WHERE id = $2`,
        [addon.quantity_granted, userId]
      );

      await this.notif.create({
        userId,
        type: 'addon_purchased',
        title: 'Add-on Purchased',
        body: `You have successfully received ${addon.quantity_granted} additional image uploads.`,
        referenceId: String(addon.id),
        referenceType: 'addon',
      });

      await this.db.query('COMMIT');
    } catch (e) {
      await this.db.query('ROLLBACK');
      throw e;
    }

    return { success: true };
  }

  async adminCreateSubscription(adminUserId: string, targetUserId: string, planId: string, durationDays: number = 30) {
    const { rows: planRows } = await this.db.query(
      `SELECT * FROM membership_plans WHERE id = $1 AND is_active = true`,
      [planId]
    );
    if (!planRows[0]) throw new NotFoundError('Plan not found');

    const { rows: existingSub } = await this.db.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 AND status IN ('trialing', 'active')`,
      [targetUserId]
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    await this.db.query('BEGIN');
    try {
      if (existingSub.length > 0) {
        await this.db.query(
          `UPDATE subscriptions SET status = 'active', expires_at = $1, plan_id = $2, updated_at = NOW() WHERE id = $3`,
          [expiresAt, planId, existingSub[0].id]
        );
      } else {
        await this.db.query(
          `INSERT INTO subscriptions (user_id, plan_id, status, expires_at) VALUES ($1, $2, 'active', $3)`,
          [targetUserId, planId, expiresAt]
        );
      }

      await this.db.query(
        `UPDATE users SET membership_tier = 'pro' WHERE id = $1`,
        [targetUserId]
      );

      await this.notif.create({
        userId: targetUserId,
        type: 'admin_subscription_granted',
        title: 'Pro Subscription Granted',
        body: `An administrator has granted you a Pro subscription for ${durationDays} days.`,
        referenceId: planId,
        referenceType: 'subscription',
      });

      await this.db.query('COMMIT');
    } catch (e) {
      await this.db.query('ROLLBACK');
      throw e;
    }

    return { success: true, message: `Pro subscription activated for user` };
  }

  async adminGrantAddons(adminUserId: string, targetUserId: string, quantity: number) {
    await this.db.query('BEGIN');
    try {
      await this.db.query(
        `UPDATE users SET addon_image_limit = addon_image_limit + $1 WHERE id = $2`,
        [quantity, targetUserId]
      );

      await this.notif.create({
        userId: targetUserId,
        type: 'admin_addon_granted',
        title: 'Add-on Credits Granted',
        body: `An administrator has granted you ${quantity} additional image upload credits.`,
        referenceId: targetUserId,
        referenceType: 'addon',
      });

      await this.db.query('COMMIT');
    } catch (e) {
      await this.db.query('ROLLBACK');
      throw e;
    }

    return { success: true, message: `${quantity} addon credits granted to user` };
  }
}
