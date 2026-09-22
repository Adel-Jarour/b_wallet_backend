const express = require('express');
const { authenticate } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
  readAllNotificationsSchema
} = require('../schemas/notification.schema');
const {
  listNotifications,
  markAsRead,
  markAllAsRead
} = require('../controllers/notification.controller');

const router = express.Router();

// All notification routes require an authenticated user
router.use(authenticate);

/**
 * GET /api/v1/notifications
 * List user notifications, filterable by category and is_read
 */
router.get('/', validate(listNotificationsQuerySchema, 'query'), listNotifications);

/**
 * PATCH /api/v1/notifications/:id/read
 * Mark a single notification as read
 */
router.patch('/:id/read', validate(notificationIdParamSchema, 'params'), markAsRead);

/**
 * POST /api/v1/notifications/read-all
 * Mark all notifications as read for the user
 */
router.post('/read-all', validate(readAllNotificationsSchema, 'body'), markAllAsRead);

module.exports = router;
