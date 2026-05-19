import { Service, Inject } from 'typedi';
import { Pool } from 'pg';
import { NotificationType } from '../interfaces/INotification';
import { buildMeta } from '../utils/pagination';
import logger from '../utils/logger';

// FIX #7: Firebase Admin SDK – wire up push notifications for real
// Set FIREBASE_SERVICE_ACCOUNT_JSON env var with the JSON content of your service account key
let firebaseMessaging: any = null;

const initFirebase = () => {
  if (firebaseMessaging) return firebaseMessaging;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON not set – push notifications disabled');
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
      });
    }
    firebaseMessaging = admin.messaging();
    return firebaseMessaging;
  } catch (err) {
    logger.error('Firebase init failed', { err });
    return null;
  }
};

@Service()
export class NotificationService {
  constructor(
    @Inject('notificationModel') private notificationModel: any,
    // FIX: inject pgPool to look up FCM tokens from the DB
    @Inject('pgPool') private db: Pool
  ) {}

  async create(opts: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    referenceId?: string;
    referenceType?: string;
  }, session?: any): Promise<void> {
    await this.notificationModel.create([opts], { session });
    // Fire-and-forget: push failure must not affect business logic
    this.sendPush(opts.userId, opts.title, opts.body).catch((err) =>
      logger.error('FCM push failed', { userId: opts.userId, err })
    );
  }

  async bulkCreate(
    userIds: string[],
    opts: {
      type: NotificationType;
      title: string;
      body: string;
      referenceId?: string;
    },
    session?: any
  ): Promise<void> {
    const docs = userIds.map((userId) => ({ userId, ...opts }));
    await this.notificationModel.insertMany(docs, { ordered: false, session });
    // Bulk push – fire and forget
    for (const userId of userIds) {
      this.sendPush(userId, opts.title, opts.body).catch(() => {});
    }
  }

  async getForUser(
    userId: string,
    page: number,
    limit: number,
    unreadOnly: boolean
  ) {
    const filter: Record<string, unknown> = { userId };
    if (unreadOnly) filter.isRead = false;

    const [data, unreadCount] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit + 1) // Fetch Limit + 1
        .lean(),
      this.notificationModel.countDocuments({ userId, isRead: false }),
    ]);

    const hasNextPage = data.length > limit;
    if (hasNextPage) data.pop();

    return { 
      data, 
      unreadCount, 
      meta: buildMeta({ page, limit, hasNextPage }) 
    };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationModel.countDocuments({ userId, isRead: false });
  }

  async markRead(notificationId: string, userId: string): Promise<void> {
    await this.notificationModel.findOneAndUpdate(
      { _id: notificationId, userId },
      { $set: { isRead: true } }
    );
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.notificationModel.updateMany(
      { userId, isRead: false },
      { $set: { isRead: true } }
    );
    return result.modifiedCount;
  }

  async deleteOne(notificationId: string, userId: string): Promise<void> {
    await this.notificationModel.deleteOne({ _id: notificationId, userId });
  }

  async getSettings(userId: string): Promise<any> {
    const { rows } = await this.db.query(
      `SELECT * FROM notification_settings WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      const defaults = {
        jobProposals: true,
        chatMessages: true,
        followers: true,
        likesComments: true,
        payments: true,
        promotions: true,
        emailNotifications: true,
        pushNotifications: true,
      };
      await this.db.query(
        `INSERT INTO notification_settings (user_id, settings, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())`,
        [userId, JSON.stringify(defaults)]
      );
      return defaults;
    }

    try {
      return JSON.parse(rows[0].settings);
    } catch {
      return {};
    }
  }

  async updateSettings(userId: string, settings: any): Promise<void> {
    const settingsJson = JSON.stringify(settings);
    await this.db.query(
      `INSERT INTO notification_settings (user_id, settings, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET settings = $2, updated_at = NOW()`,
      [userId, settingsJson]
    );
  }

  // FIX #7: Actually send FCM push using Firebase Admin SDK
  private async sendPush(userId: string, title: string, body: string): Promise<void> {
    const messaging = initFirebase();
    if (!messaging) return; // Gracefully disabled if not configured

    const { rows } = await this.db.query(
      'SELECT token FROM fcm_tokens WHERE user_id = $1',
      [userId]
    );
    if (!rows.length) return;

    const tokens: string[] = rows.map((r: { token: string }) => r.token);

    try {
      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      });

      // Remove stale tokens that are no longer valid
      const staleTokens: string[] = [];
      response.responses.forEach((resp: any, idx: number) => {
        if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
          staleTokens.push(tokens[idx]);
        }
      });

      if (staleTokens.length) {
        await this.db.query(
          `DELETE FROM fcm_tokens WHERE token = ANY($1::text[])`,
          [staleTokens]
        );
      }
    } catch (err) {
      logger.error('FCM sendEachForMulticast failed', { userId, err });
    }
  }
}
