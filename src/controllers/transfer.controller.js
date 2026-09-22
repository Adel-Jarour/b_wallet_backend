const TransferService = require('../services/transfer.service');
const ApiError = require('../utils/ApiError');
const { transferSchema } = require('../schemas/transfer.schema');
const logger = require('../config/logger');

/**
 * POST /api/v1/transfers
 *
 * Executes an atomic P2P fund transfer from the authenticated user to a recipient.
 *
 * Required headers:
 *   - Authorization: Bearer <JWT>
 *   - X-Idempotency-Key: <UUIDv4>
 *
 * Body:
 *   - receiverPhone: E.164 format (e.g. "+15551234567") — OR —
 *   - receiverEmail: valid email
 *   - amount: positive decimal, max 2 decimal places, max 2500
 *   - category: one of Food|Expense|Property|Hobby|Entertainment
 *   - note: optional string (max 255 chars)
 *   - transactionTicket: HMAC-signed ticket from POST /auth/pin/verify
 */
async function initiateTransfer(req, res, next) {
  try {
    // Validate request body
    const parseResult = transferSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      return next(
        ApiError.badRequest(
          firstError.message,
          'VALIDATION_ERROR',
          parseResult.error.errors
        )
      );
    }

    const data = parseResult.data;

    // Sender is derived from the verified JWT — never trusted from the body
    const senderId = req.userId;
    const idempotencyKey = req.idempotencyKey; // set by checkIdempotency middleware

    logger.info(
      { senderId, amount: data.amount, category: data.category },
      'Transfer initiation request received'
    );

    const receipt = await TransferService.executeTransfer(senderId, {
      ...data,
      idempotencyKey
    });

    const responseBody = {
      success: true,
      data: {
        message: 'Transfer completed successfully',
        receipt
      }
    };

    // Cache the response for idempotency replay
    if (req.cacheIdempotencyResponse) {
      await req.cacheIdempotencyResponse(201, responseBody);
    }

    logger.info(
      { senderId, txRef: receipt.transactionReference, amount: data.amount },
      'Transfer completed successfully'
    );

    return res.status(201).json(responseBody);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/transfers/:reference
 *
 * Retrieves a transfer receipt by transaction reference.
 * Only the sender or receiver may retrieve the receipt.
 */
async function getTransferReceipt(req, res, next) {
  try {
    const { reference } = req.params;
    const requestingUserId = req.userId;

    if (!reference || typeof reference !== 'string') {
      return next(ApiError.badRequest('Transaction reference is required', 'REFERENCE_MISSING'));
    }

    const receipt = await TransferService.getTransferByReference(reference, requestingUserId);

    return res.status(200).json({
      success: true,
      data: { receipt }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  initiateTransfer,
  getTransferReceipt
};
