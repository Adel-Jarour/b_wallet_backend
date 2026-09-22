const express = require('express');
const { authenticate } = require('../middlewares/auth');
const { checkIdempotency } = require('../middlewares/idempotency');
const { financialLimiter } = require('../middlewares/rateLimiter');
const { validateAmlLimits } = require('../middlewares/amlValidation');
const { initiateTransfer, getTransferReceipt } = require('../controllers/transfer.controller');

const router = express.Router();

/**
 * POST /api/v1/transfers
 *
 * Executes an atomic P2P fund transfer.
 *
 * Middleware chain:
 *   1. authenticate — validates JWT, sets req.userId
 *   2. financialLimiter — 10 transfers / minute per user
 *   3. validateAmlLimits — verifies account freeze status and velocity limits
 *   4. checkIdempotency — validates X-Idempotency-Key, blocks duplicates, sets req.idempotencyKey
 *   5. initiateTransfer — business logic
 */
router.post('/', authenticate, financialLimiter, validateAmlLimits, checkIdempotency, initiateTransfer);

/**
 * GET /api/v1/transfers/:reference
 *
 * Retrieves transfer receipt by transaction reference (e.g. TXN-20260912-ABCD1234).
 * Only sender or receiver may retrieve the receipt (enforced in service layer).
 */
router.get('/:reference', authenticate, getTransferReceipt);

module.exports = router;
