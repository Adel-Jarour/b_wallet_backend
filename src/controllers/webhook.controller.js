const TopUpService = require('../services/topup.service');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

// ============================================================================
// POST /api/v1/webhooks/payments
// Secure payment gateway webhook handler
// ============================================================================
async function handlePaymentWebhook(req, res, next) {
  try {
    // Prefer req.rawBody preserved by body-parser verify callback
    const rawBody = req.rawBody || (typeof req.body === 'string' ? Buffer.from(req.body) : Buffer.from(JSON.stringify(req.body)));

    const result = await TopUpService.handleWebhook(rawBody, req.headers);

    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  handlePaymentWebhook
};
