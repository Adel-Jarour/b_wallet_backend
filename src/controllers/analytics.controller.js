const AnalyticsService = require('../services/analytics.service');
const ApiError = require('../utils/ApiError');
const { cashFlowQuerySchema } = require('../schemas/analytics.schema');
const logger = require('../config/logger');

// ============================================================================
// GET /api/v1/analytics/cash-flow
// Cash flow analytics endpoint (FR-ANA-001, FR-ANA-002, FR-ANA-003)
// ============================================================================
async function getCashFlow(req, res, next) {
  try {
    const parseResult = cashFlowQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      return next(ApiError.badRequest(firstError.message, 'VALIDATION_ERROR', parseResult.error.errors));
    }

    const userId = req.userId;
    const analytics = await AnalyticsService.getCashFlow(userId, parseResult.data);

    return res.status(200).json({
      success: true,
      data: analytics
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getCashFlow
};
