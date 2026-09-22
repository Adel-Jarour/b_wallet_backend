const PaymentRequestService = require('../services/payment_request.service');
const ApiError = require('../utils/ApiError');
const {
  createRequestSchema,
  listRequestsSchema,
  payRequestSchema
} = require('../schemas/payment_request.schema');
const logger = require('../config/logger');

// ============================================================================
// POST /api/v1/requests
// Create a new payment request
// ============================================================================
async function createRequest(req, res, next) {
  try {
    const parseResult = createRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      return next(ApiError.badRequest(firstError.message, 'VALIDATION_ERROR', parseResult.error.errors));
    }

    const requesterId = req.userId;
    const request = await PaymentRequestService.createRequest(requesterId, parseResult.data);

    logger.info({ requesterId, payerId: request.payerId, amount: request.amount }, 'Payment request created');

    return res.status(201).json({
      success: true,
      data: {
        message: 'Payment request created successfully',
        request
      }
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// GET /api/v1/requests
// List payment requests for the authenticated user
// ============================================================================
async function listRequests(req, res, next) {
  try {
    const parseResult = listRequestsSchema.safeParse(req.query);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      return next(ApiError.badRequest(firstError.message, 'VALIDATION_ERROR', parseResult.error.errors));
    }

    const userId = req.userId;
    const result = await PaymentRequestService.listRequests(userId, parseResult.data);

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// GET /api/v1/requests/:id
// Retrieve a single payment request by ID
// ============================================================================
async function getRequest(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const request = await PaymentRequestService.getRequestById(id, userId);

    return res.status(200).json({
      success: true,
      data: { request }
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// POST /api/v1/requests/:id/pay
// Settle a payment request ("Pay Now")
// Requires PIN or transaction ticket + X-Idempotency-Key
// ============================================================================
async function payRequest(req, res, next) {
  try {
    const { id } = req.params;
    const payerId = req.userId;
    const idempotencyKey = req.idempotencyKey; // set by checkIdempotency middleware

    const parseResult = payRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      return next(ApiError.badRequest(firstError.message, 'VALIDATION_ERROR', parseResult.error.errors));
    }

    logger.info({ requestId: id, payerId }, 'Payment request settlement initiated');

    const receipt = await PaymentRequestService.payRequest(
      id,
      payerId,
      parseResult.data,
      idempotencyKey
    );

    const responseBody = {
      success: true,
      data: {
        message: 'Payment request settled successfully',
        receipt
      }
    };

    // Cache for idempotency replay
    if (req.cacheIdempotencyResponse) {
      await req.cacheIdempotencyResponse(200, responseBody);
    }

    logger.info(
      { requestId: id, payerId, txRef: receipt.transactionReference },
      'Payment request settled successfully'
    );

    return res.status(200).json(responseBody);
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// POST /api/v1/requests/:id/decline
// Payer declines an incoming payment request
// ============================================================================
async function declineRequest(req, res, next) {
  try {
    const { id } = req.params;
    const payerId = req.userId;

    const request = await PaymentRequestService.declineRequest(id, payerId);

    logger.info({ requestId: id, payerId }, 'Payment request declined');

    return res.status(200).json({
      success: true,
      data: {
        message: 'Payment request declined',
        request
      }
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// POST /api/v1/requests/:id/cancel
// Requester cancels their own outgoing payment request
// ============================================================================
async function cancelRequest(req, res, next) {
  try {
    const { id } = req.params;
    const requesterId = req.userId;

    const request = await PaymentRequestService.cancelRequest(id, requesterId);

    logger.info({ requestId: id, requesterId }, 'Payment request cancelled');

    return res.status(200).json({
      success: true,
      data: {
        message: 'Payment request cancelled',
        request
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createRequest,
  listRequests,
  getRequest,
  payRequest,
  declineRequest,
  cancelRequest
};
