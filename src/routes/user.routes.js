const express = require('express');
const { authenticate } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const { registerDeviceTokenSchema } = require('../schemas/notification.schema');
const { registerDeviceToken } = require('../controllers/notification.controller');

const { deviceTokenLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

// All user routes require authentication
router.use(authenticate);

/**
 * POST /api/v1/users/device-token
 * Register device FCM push notification token
 */
router.post('/device-token', deviceTokenLimiter, validate(registerDeviceTokenSchema, 'body'), registerDeviceToken);

module.exports = router;
