/**
 * Notification Service
 *
 * Manages in-app notifications and background push notifications (FCM).
 * Integrates with transaction, payment request, and security events.
 *
 * FINANCIAL INTEGRATION GUARANTEE:
 * All notification dispatches triggered by transactions are non-blocking.
 * Failures in notification creation or push delivery never roll back
 * or fail the underlying financial transaction.
 */

const { supabaseAdmin } = require('../config/supabase');
const { sendMulticast, pushProvider } = require('../config/firebase');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');

const VALID_CATEGORIES = ['TRANSACTIONS', 'PROMOS', 'SYSTEM'];

class NotificationService {
  /**
   * Creates an in-app notification record and attempts push notification delivery.
   *
   * @param {object} params
   * @param {string} params.userId - Recipient user UUID
   * @param {string} params.category - 'TRANSACTIONS' | 'PROMOS' | 'SYSTEM'
   * @param {string} params.title - Notification title
   * @param {string} params.body - Notification body content
   * @param {object} [params.metadata={}] - Structured metadata
   * @returns {Promise<object>} Created notification record
   */
  static async createNotification({ userId, category = 'SYSTEM', title, body, metadata = {} }) {
    if (!userId) {
      throw ApiError.badRequest('User ID is required for notification', 'NOTIFICATION_USER_REQUIRED');
    }

    if (!VALID_CATEGORIES.includes(category)) {
      throw ApiError.badRequest(
        `Invalid notification category: ${category}. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
        'INVALID_NOTIFICATION_CATEGORY'
      );
    }

    // 1. Insert in-app notification record
    const { data: notification, error: dbError } = await supabaseAdmin
      .from('notifications')
      .insert({
        user_id: userId,
        category,
        title,
        body,
        is_read: false,
        metadata
      })
      .select('id, user_id, category, title, body, is_read, metadata, created_at')
      .single();

    if (dbError) {
      logger.error({ err: dbError.message, userId, category }, 'Failed to insert notification record');
      throw ApiError.internal('Failed to record notification', 'NOTIFICATION_DB_ERROR');
    }

    // 2. Dispatch push notification via FCM to registered devices (non-blocking)
    this._dispatchPushToUser(userId, { title, body, metadata }).catch((err) => {
      logger.warn({ err: err.message, userId }, 'Background push dispatch failed (non-fatal)');
    });

    return notification;
  }

  /**
   * Internal helper: Dispatches push notifications to all active device tokens for a user.
   */
  static async _dispatchPushToUser(userId, { title, body, metadata = {} }) {
    try {
      const { data: tokens, error } = await supabaseAdmin
        .from('device_tokens')
        .select('token')
        .eq('user_id', userId);

      if (error || !tokens || !tokens.length) {
        return;
      }

      const tokenList = tokens.map(t => t.token).filter(Boolean);
      if (!tokenList.length) return;

      await sendMulticast({
        tokens: tokenList,
        title,
        body,
        data: metadata
      });
    } catch (err) {
      logger.warn({ err: err.message, userId }, 'Failed to send push notification to user devices');
    }
  }

  /**
   * Lists notifications for a user with category/read filters and pagination.
   *
   * @param {string} userId - Authenticated user UUID
   * @param {object} filters - { category, isRead, page, limit }
   * @returns {Promise<object>} Paginated notifications with unread count
   */
  static async listNotifications(userId, { category, isRead, page = 1, limit = 20 } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let query = supabaseAdmin
      .from('notifications')
      .select('id, category, title, body, is_read, metadata, created_at', { count: 'exact' })
      .eq('user_id', userId);

    if (category) {
      if (!VALID_CATEGORIES.includes(category)) {
        throw ApiError.badRequest(
          `Invalid category filter: ${category}. Allowed: ${VALID_CATEGORIES.join(', ')}`,
          'INVALID_CATEGORY'
        );
      }
      query = query.eq('category', category);
    }

    if (isRead !== undefined && isRead !== null && isRead !== '') {
      const boolRead = isRead === true || isRead === 'true';
      query = query.eq('is_read', boolRead);
    }

    query = query.order('created_at', { ascending: false }).range(offset, offset + limitNum - 1);

    const { data: notifications, error, count } = await query;

    if (error) {
      logger.error({ err: error.message, userId }, 'Failed to fetch notifications');
      throw ApiError.internal('Failed to retrieve notifications', 'NOTIFICATIONS_FETCH_ERROR');
    }

    // Get unread count for badge
    const { count: unreadCount, error: countErr } = await supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (countErr) {
      logger.warn({ err: countErr.message, userId }, 'Failed to fetch unread notification count');
    }

    return {
      notifications: notifications || [],
      total: count || 0,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil((count || 0) / limitNum),
      unreadCount: unreadCount || 0
    };
  }

  /**
   * Marks a single notification as read.
   *
   * @param {string} notificationId - Notification UUID
   * @param {string} userId - Authenticated user UUID
   * @returns {Promise<object>} Updated notification
   */
  static async markAsRead(notificationId, userId) {
    const { data: existing, error: findError } = await supabaseAdmin
      .from('notifications')
      .select('id, user_id, is_read')
      .eq('id', notificationId)
      .single();

    if (findError || !existing) {
      throw ApiError.notFound('Notification not found', 'NOTIFICATION_NOT_FOUND');
    }

    if (existing.user_id !== userId) {
      throw ApiError.forbidden('You are not authorized to update this notification', 'NOTIFICATION_FORBIDDEN');
    }

    if (existing.is_read) {
      return existing;
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .select('id, category, title, body, is_read, metadata, created_at')
      .single();

    if (updateError) {
      logger.error({ err: updateError.message, notificationId }, 'Failed to mark notification as read');
      throw ApiError.internal('Failed to update notification', 'NOTIFICATION_UPDATE_ERROR');
    }

    return updated;
  }

  /**
   * Marks all unread notifications as read for a user.
   *
   * @param {string} userId - Authenticated user UUID
   * @param {string} [category] - Optional category filter
   * @returns {Promise<{ updatedCount: number }>}
   */
  static async markAllAsRead(userId, category) {
    let query = supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (category) {
      if (!VALID_CATEGORIES.includes(category)) {
        throw ApiError.badRequest(
          `Invalid category filter: ${category}`,
          'INVALID_CATEGORY'
        );
      }
      query = query.eq('category', category);
    }

    const { data, error, count } = await query.select('id');

    if (error) {
      logger.error({ err: error.message, userId }, 'Failed to mark all notifications as read');
      throw ApiError.internal('Failed to update notifications', 'NOTIFICATIONS_UPDATE_ALL_ERROR');
    }

    return { updatedCount: data ? data.length : (count || 0) };
  }

  /**
   * Registers or updates a device token for push notifications.
   *
   * @param {string} userId - Authenticated user UUID
   * @param {object} params
   * @param {string} params.token - FCM device token
   * @param {string} [params.platform='android'] - 'android' | 'ios' | 'web'
   * @returns {Promise<object>} Registered device token details
   */
  static async registerDeviceToken(userId, { token, platform = 'android' }) {
    if (!token || typeof token !== 'string' || !token.trim()) {
      throw ApiError.badRequest('A valid device token is required', 'DEVICE_TOKEN_REQUIRED');
    }

    const cleanToken = token.trim();
    const cleanPlatform = (platform || 'android').toLowerCase();

    if (!['android', 'ios', 'web'].includes(cleanPlatform)) {
      throw ApiError.badRequest('Platform must be android, ios, or web', 'INVALID_PLATFORM');
    }

    const { data, error } = await supabaseAdmin
      .from('device_tokens')
      .upsert(
        {
          user_id: userId,
          token: cleanToken,
          platform: cleanPlatform,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'user_id, token' }
      )
      .select('id, user_id, token, platform, updated_at')
      .single();

    if (error) {
      logger.error({ err: error.message, userId }, 'Failed to register device token');
      throw ApiError.internal('Failed to register device token', 'DEVICE_TOKEN_REGISTER_ERROR');
    }

    return data;
  }

  // ============================================================================
  // Transaction & Security Event Notification Triggers
  // All these helpers are strictly post-commit and never throw fatal errors
  // ============================================================================

  /**
   * Notifies receiver of an inbound fund transfer.
   */
  static async notifyTransferReceived({
    senderId,
    receiverId,
    amount,
    currency,
    transactionId,
    transactionReference,
    note
  }) {
    try {
      // Lookup sender profile
      const { data: sender } = await supabaseAdmin
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', senderId)
        .single();

      const senderName = sender ? `${sender.first_name || ''} ${sender.last_name || ''}`.trim() : 'Someone';
      const formattedAmount = `${currency} ${parseFloat(amount).toFixed(2)}`;

      await this.createNotification({
        userId: receiverId,
        category: 'TRANSACTIONS',
        title: 'Funds Received',
        body: `You received ${formattedAmount} from ${senderName || 'a B-Wallet user'}.`,
        metadata: {
          transactionId,
          transactionReference,
          senderId,
          amount,
          currency,
          note: note || null,
          type: 'TRANSFER_RECEIVED'
        }
      });
    } catch (err) {
      logger.error({ err: err.message, receiverId, transactionId }, 'Failed to send transfer notification (non-fatal)');
    }
  }

  /**
   * Notifies payer of an inbound payment request.
   */
  static async notifyPaymentRequestReceived({ requesterId, payerId, requestId, amount, currency, note }) {
    try {
      const { data: requester } = await supabaseAdmin
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', requesterId)
        .single();

      const requesterName = requester ? `${requester.first_name || ''} ${requester.last_name || ''}`.trim() : 'A user';
      const formattedAmount = `${currency} ${parseFloat(amount).toFixed(2)}`;

      await this.createNotification({
        userId: payerId,
        category: 'TRANSACTIONS',
        title: 'Payment Request Received',
        body: `${requesterName} requested ${formattedAmount}${note ? ` for: "${note}"` : ''}.`,
        metadata: {
          requestId,
          requesterId,
          amount,
          currency,
          note: note || null,
          type: 'PAYMENT_REQUEST_RECEIVED'
        }
      });
    } catch (err) {
      logger.error({ err: err.message, payerId, requestId }, 'Failed to send payment request notification (non-fatal)');
    }
  }

  /**
   * Notifies requester that their payment request was paid.
   */
  static async notifyPaymentRequestSettled({ payerId, requesterId, requestId, transactionId, amount, currency }) {
    try {
      const { data: payer } = await supabaseAdmin
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', payerId)
        .single();

      const payerName = payer ? `${payer.first_name || ''} ${payer.last_name || ''}`.trim() : 'A user';
      const formattedAmount = `${currency} ${parseFloat(amount).toFixed(2)}`;

      await this.createNotification({
        userId: requesterId,
        category: 'TRANSACTIONS',
        title: 'Payment Request Paid',
        body: `${payerName} paid your request of ${formattedAmount}.`,
        metadata: {
          requestId,
          transactionId,
          payerId,
          amount,
          currency,
          type: 'PAYMENT_REQUEST_PAID'
        }
      });
    } catch (err) {
      logger.error({ err: err.message, requesterId, requestId }, 'Failed to send request settled notification (non-fatal)');
    }
  }

  /**
   * Notifies requester that their payment request was declined.
   */
  static async notifyPaymentRequestDeclined({ payerId, requesterId, requestId, amount, currency }) {
    try {
      const { data: payer } = await supabaseAdmin
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', payerId)
        .single();

      const payerName = payer ? `${payer.first_name || ''} ${payer.last_name || ''}`.trim() : 'A user';
      const formattedAmount = `${currency} ${parseFloat(amount).toFixed(2)}`;

      await this.createNotification({
        userId: requesterId,
        category: 'TRANSACTIONS',
        title: 'Payment Request Declined',
        body: `${payerName} declined your payment request of ${formattedAmount}.`,
        metadata: {
          requestId,
          payerId,
          amount,
          currency,
          type: 'PAYMENT_REQUEST_DECLINED'
        }
      });
    } catch (err) {
      logger.error({ err: err.message, requesterId, requestId }, 'Failed to send request declined notification (non-fatal)');
    }
  }

  /**
   * Notifies user of a PIN lockout security alert.
   */
  static async notifyPinLockout({ userId, lockedUntil }) {
    try {
      await this.createNotification({
        userId,
        category: 'SYSTEM',
        title: 'Security Alert: PIN Locked',
        body: 'Your transaction PIN has been temporarily locked due to 3 consecutive failed attempts.',
        metadata: {
          lockedUntil,
          type: 'PIN_LOCKOUT'
        }
      });
    } catch (err) {
      logger.error({ err: err.message, userId }, 'Failed to send PIN lockout notification (non-fatal)');
    }
  }
}

module.exports = NotificationService;
