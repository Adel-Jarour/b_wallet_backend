const TopUpService = require('../services/topup.service');
const ApiError = require('../utils/ApiError');
const { createTopUpIntentSchema } = require('../schemas/topup.schema');
const logger = require('../config/logger');

// ============================================================================
// POST /api/v1/top-up/intent
// Create top-up payment intent with gateway
// ============================================================================
async function createIntent(req, res, next) {
  try {
    const parseResult = createTopUpIntentSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      return next(ApiError.badRequest(firstError.message, 'VALIDATION_ERROR', parseResult.error.errors));
    }

    const result = await TopUpService.createIntent(req.userId, parseResult.data);

    return res.status(201).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createIntent
};
