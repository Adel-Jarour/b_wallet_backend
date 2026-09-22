/**
 * Notification Center Controller
 *
 * Exposes endpoints for managing user in-app notifications and registering
 * device push tokens (FCM/APNs).
 */

const NotificationService = require('../services/notification.service');

/**
 * GET /api/v1/notifications
 * List notifications for the authenticated user, optionally filtered by category and is_read.
 */
async function listNotifications(req, res, next) {
  try {
    const userId = req.userId;
    const { category, isRead, is_read, page, limit } = req.query;

    const result = await NotificationService.listNotifications(userId, {
      category,
      isRead: isRead !== undefined ? isRead : is_read,
      page,
      limit
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/v1/notifications/:id/read
 * Mark a specific notification as read.
 */
async function markAsRead(req, res, next) {
  try {
    const userId = req.userId;
    const notificationId = req.params.id;

    const notification = await NotificationService.markAsRead(notificationId, userId);

    return res.status(200).json({
      success: true,
      data: notification
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/notifications/read-all
 * Mark all notifications as read for the user (optional category filter).
 */
async function markAllAsRead(req, res, next) {
  try {
    const userId = req.userId;
    const category = req.body ? req.body.category : undefined;

    const result = await NotificationService.markAllAsRead(userId, category);

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/users/device-token
 * Register or update an FCM push notification device token.
 */
async function registerDeviceToken(req, res, next) {
  try {
    const userId = req.userId;
    const { token, platform } = req.body;

    const result = await NotificationService.registerDeviceToken(userId, {
      token,
      platform: platform || 'android'
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listNotifications,
  markAsRead,
  markAllAsRead,
  registerDeviceToken
};
