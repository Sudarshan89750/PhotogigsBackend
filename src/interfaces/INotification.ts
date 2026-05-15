export type NotificationType =
  | 'proposal_received'
  | 'proposal_accepted'
  | 'proposal_rejected'
  | 'job_completed'
  | 'work_submitted'
  | 'revision_requested'
  | 'payment_released'
  | 'payment_marked'
  | 'receipt_confirmed'
  | 'new_message'
  | 'new_follower'
  | 'post_liked'
  | 'post_commented'
  | 'account_approved'
  | 'dispute_raised'
  | 'dispute_resolved'
  | 'campaign'
  | 'review_received'
  | 'new_order'
  | 'subscription_active'
  | 'addon_purchased'
  | 'admin_subscription_granted'
  | 'admin_addon_granted';

export interface INotification {
  _id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  referenceId?: string;
  referenceType?: string;
  isRead: boolean;
  createdAt: Date;
}
