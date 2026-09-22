const { z } = require('zod');

const VALID_CATEGORIES = ['TRANSACTIONS', 'PROMOS', 'SYSTEM'];

/**
 * Schema for GET /api/v1/notifications query parameters
 */
const listNotificationsQuerySchema = z.object({
  category: z.enum(VALID_CATEGORIES, {
    errorMap: () => ({ message: `category must be one of: ${VALID_CATEGORIES.join(', ')}` })
  }).optional(),
  isRead: z.union([z.boolean(), z.enum(['true', 'false'])]).optional().transform(v => {
    if (v === undefined) return undefined;
    return v === true || v === 'true';
  }),
  is_read: z.union([z.boolean(), z.enum(['true', 'false'])]).optional().transform(v => {
    if (v === undefined) return undefined;
    return v === true || v === 'true';
  }),
  page: z.coerce.number().int().positive().default(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20).optional()
});

/**
 * Schema for PATCH /api/v1/notifications/:id/read param
 */
const notificationIdParamSchema = z.object({
  id: z.string().uuid('Invalid notification ID format')
});

/**
 * Schema for POST /api/v1/notifications/read-all
 */
const readAllNotificationsSchema = z.object({
  category: z.enum(VALID_CATEGORIES).optional().nullable()
});

/**
 * Schema for POST /api/v1/users/device-token
 */
const registerDeviceTokenSchema = z.object({
  token: z.string({ required_error: 'token is required' }).trim().min(1, 'token cannot be empty'),
  platform: z.enum(['android', 'ios', 'web'], {
    errorMap: () => ({ message: 'platform must be one of: android, ios, web' })
  }).default('android').optional()
});

module.exports = {
  VALID_CATEGORIES,
  listNotificationsQuerySchema,
  notificationIdParamSchema,
  readAllNotificationsSchema,
  registerDeviceTokenSchema
};
