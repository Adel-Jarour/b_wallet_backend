const express = require('express');
const webhookController = require('../controllers/webhook.controller');

const { webhookLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

// Webhook endpoints are unauthenticated but cryptographically protected by HMAC-SHA256 signature verification
// POST /api/v1/webhooks/payments - Secure gateway webhook listener
router.post('/payments', webhookLimiter, webhookController.handlePaymentWebhook);

module.exports = router;
