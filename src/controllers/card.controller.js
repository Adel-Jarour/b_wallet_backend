const CardService = require('../services/card.service');
const ApiError = require('../utils/ApiError');
const { saveCardSchema, checkForbiddenRawFields } = require('../schemas/card.schema');
const logger = require('../config/logger');

// ============================================================================
// POST /api/v1/cards
// Save tokenized card reference (PCI-DSS Level 4 compliant)
// ============================================================================
async function saveCard(req, res, next) {
  try {
    // 1. Strict PCI-DSS check: Immediately reject any payload containing raw PAN or CVC
    const forbiddenField = checkForbiddenRawFields(req.body);
    if (forbiddenField) {
      logger.warn({ userId: req.userId, forbiddenField }, 'Security rejection: client submitted raw card field');
      return next(
        ApiError.badRequest(
          `Raw card data (${forbiddenField}) is strictly prohibited under PCI-DSS compliance. Submit only gateway tokenized references.`,
          'PCI_DSS_VIOLATION'
        )
      );
    }

    // 2. Validate tokenized payload
    const parseResult = saveCardSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      return next(ApiError.badRequest(firstError.message, 'VALIDATION_ERROR', parseResult.error.errors));
    }

    const card = await CardService.saveCard(req.userId, parseResult.data);

    return res.status(201).json({
      success: true,
      data: {
        message: 'Card saved successfully',
        card
      }
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// GET /api/v1/cards
// List user's saved cards
// ============================================================================
async function listCards(req, res, next) {
  try {
    const cards = await CardService.listCards(req.userId);

    return res.status(200).json({
      success: true,
      data: {
        cards
      }
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// DELETE /api/v1/cards/:id
// Remove saved card
// ============================================================================
async function deleteCard(req, res, next) {
  try {
    const cardId = req.params.id;
    const result = await CardService.deleteCard(req.userId, cardId);

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// PATCH /api/v1/cards/:id/default
// Set card as default payment method
// ============================================================================
async function setDefaultCard(req, res, next) {
  try {
    const cardId = req.params.id;
    const card = await CardService.setDefaultCard(req.userId, cardId);

    return res.status(200).json({
      success: true,
      data: {
        message: 'Default payment method updated',
        card
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  saveCard,
  listCards,
  deleteCard,
  setDefaultCard
};
