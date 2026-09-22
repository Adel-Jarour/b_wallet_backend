const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

class CardService {
  /**
   * Saves a tokenized card reference for a user.
   * Ensures default card invariants:
   * - If is_default is true, unsets is_default on other cards for this user.
   * - If user has no existing cards, automatically sets is_default = true.
   */
  static async saveCard(userId, cardData) {
    // Check existing card count
    const { data: existingCards, error: countErr } = await supabaseAdmin
      .from('saved_cards')
      .select('id, is_default')
      .eq('user_id', userId);

    if (countErr) {
      logger.error({ err: countErr.message, userId }, 'Error checking existing cards');
      throw ApiError.internal('Failed to query existing cards');
    }

    const hasCards = existingCards && existingCards.length > 0;
    const shouldBeDefault = !hasCards || cardData.is_default === true;

    if (shouldBeDefault && hasCards) {
      // Unset previous defaults
      const { error: resetErr } = await supabaseAdmin
        .from('saved_cards')
        .update({ is_default: false })
        .eq('user_id', userId);

      if (resetErr) {
        logger.error({ err: resetErr.message, userId }, 'Failed to reset previous default card');
        throw ApiError.internal('Failed to update card preferences');
      }
    }

    const newCardRecord = {
      user_id: userId,
      gateway_payment_method_id: cardData.gateway_payment_method_id,
      gateway_customer_id: cardData.gateway_customer_id || null,
      brand: cardData.brand,
      last4: cardData.last4,
      expiry_month: cardData.expiry_month,
      expiry_year: cardData.expiry_year,
      is_default: shouldBeDefault
    };

    const { data: savedCard, error: insertErr } = await supabaseAdmin
      .from('saved_cards')
      .insert(newCardRecord)
      .select('id, brand, last4, expiry_month, expiry_year, is_default, gateway_payment_method_id, created_at')
      .single();

    if (insertErr) {
      logger.error({ err: insertErr.message, userId }, 'Failed to insert saved card');
      throw ApiError.internal('Failed to save card payment method');
    }

    logger.info({ userId, cardId: savedCard.id, last4: savedCard.last4, brand: savedCard.brand }, 'Tokenized card saved successfully');

    return savedCard;
  }

  /**
   * Lists all tokenized cards saved by a user.
   */
  static async listCards(userId) {
    const { data: cards, error } = await supabaseAdmin
      .from('saved_cards')
      .select('id, brand, last4, expiry_month, expiry_year, is_default, gateway_payment_method_id, created_at')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      logger.error({ err: error.message, userId }, 'Failed to list saved cards');
      throw ApiError.internal('Failed to retrieve saved cards');
    }

    return cards || [];
  }

  /**
   * Retrieves a single card by ID, ensuring user ownership.
   */
  static async getCardById(userId, cardId) {
    const { data: card, error } = await supabaseAdmin
      .from('saved_cards')
      .select('id, brand, last4, expiry_month, expiry_year, is_default, gateway_payment_method_id, created_at')
      .eq('id', cardId)
      .eq('user_id', userId)
      .single();

    if (error || !card) {
      throw ApiError.notFound('Card not found', 'CARD_NOT_FOUND');
    }

    return card;
  }

  /**
   * Sets a specific card as the default payment method for a user.
   */
  static async setDefaultCard(userId, cardId) {
    // 1. Verify card exists and belongs to user
    await this.getCardById(userId, cardId);

    // 2. Unset all cards for user
    const { error: resetErr } = await supabaseAdmin
      .from('saved_cards')
      .update({ is_default: false })
      .eq('user_id', userId);

    if (resetErr) {
      logger.error({ err: resetErr.message, userId }, 'Failed to unset default cards');
      throw ApiError.internal('Failed to update default card');
    }

    // 3. Set target card as default
    const { data: updatedCard, error: setErr } = await supabaseAdmin
      .from('saved_cards')
      .update({ is_default: true })
      .eq('id', cardId)
      .eq('user_id', userId)
      .select('id, brand, last4, expiry_month, expiry_year, is_default, gateway_payment_method_id, created_at')
      .single();

    if (setErr) {
      logger.error({ err: setErr.message, userId, cardId }, 'Failed to set card as default');
      throw ApiError.internal('Failed to set default card');
    }

    logger.info({ userId, cardId }, 'Default payment card updated');
    return updatedCard;
  }

  /**
   * Deletes a saved card.
   * If the deleted card was the default, automatically sets the most recent
   * remaining card as default.
   */
  static async deleteCard(userId, cardId) {
    // 1. Verify card exists and belongs to user
    const card = await this.getCardById(userId, cardId);

    // 2. Delete the card
    const { error: deleteErr } = await supabaseAdmin
      .from('saved_cards')
      .delete()
      .eq('id', cardId)
      .eq('user_id', userId);

    if (deleteErr) {
      logger.error({ err: deleteErr.message, userId, cardId }, 'Failed to delete saved card');
      throw ApiError.internal('Failed to delete card');
    }

    // 3. If deleted card was default, reassign default to newest remaining card
    if (card.is_default) {
      const { data: remaining } = await supabaseAdmin
        .from('saved_cards')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (remaining && remaining.length > 0) {
        await supabaseAdmin
          .from('saved_cards')
          .update({ is_default: true })
          .eq('id', remaining[0].id);
      }
    }

    logger.info({ userId, cardId }, 'Saved card deleted successfully');

    return {
      success: true,
      message: 'Card removed successfully'
    };
  }
}

module.exports = CardService;
