const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { checkIdempotency } = require('../middlewares/idempotency');
const {
  createRequest,
  listRequests,
  getRequest,
  payRequest,
  declineRequest,
  cancelRequest
} = require('../controllers/payment_request.controller');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/v1/requests
 * Create a new payment request
 */
router.post('/', createRequest);

/**
 * GET /api/v1/requests
 * List all payment requests for the authenticated user
 * Query params: status, direction (sent|received|all), page, limit
 */
router.get('/', listRequests);

/**
 * GET /api/v1/requests/:id
 * Get a specific payment request by ID
 */
router.get('/:id', getRequest);

const { financialLimiter } = require('../middlewares/rateLimiter');
const { validateAmlLimits } = require('../middlewares/amlValidation');

/**
 * POST /api/v1/requests/:id/pay
 * Settle a payment request ("Pay Now")
 * Requires: X-Idempotency-Key header + PIN or transactionTicket in body
 */
router.post('/:id/pay', financialLimiter, validateAmlLimits, checkIdempotency, payRequest);

/**
 * POST /api/v1/requests/:id/decline
 * Payer declines an incoming payment request
 */
router.post('/:id/decline', declineRequest);

/**
 * POST /api/v1/requests/:id/cancel
 * Requester cancels their own outgoing payment request
 */
router.post('/:id/cancel', cancelRequest);

module.exports = router;
