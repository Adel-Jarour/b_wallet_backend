const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

// AML Velocity Limits (NFR-COMP-002)
const AML_SINGLE_TRANSFER_LIMIT = 2500.00;
const AML_DAILY_LIMIT_UNVERIFIED = 10000.00;

class AmlService {
  /**
   * Validates that a proposed transfer amount complies with AML velocity limits.
   *
   * Per NFR-COMP-002:
   *   - Single transfer limit: $2,500.00 (enforced here AND in Zod schema)
   *   - Daily cumulative limit: $10,000.00 for unverified users
   *
   * @param {string} senderId - Authenticated sender user UUID
   * @param {number} amount - Proposed transfer amount in USD
   * @returns {Promise<void>} Resolves if compliant, throws ApiError if not
   */
  static async validateTransferLimits(senderId, amount) {
    // 1. Single-transfer limit (belt-and-suspenders check beyond Zod schema)
    if (amount > AML_SINGLE_TRANSFER_LIMIT) {
      throw ApiError.badRequest(
        `Transfer amount $${amount.toFixed(2)} exceeds the single-transfer AML limit of $${AML_SINGLE_TRANSFER_LIMIT.toFixed(2)} (NFR-COMP-002)`,
        'AML_SINGLE_LIMIT_EXCEEDED'
      );
    }

    // 2. Daily cumulative limit — check sender's is_verified status
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('is_verified')
      .eq('id', senderId)
      .single();

    if (profileErr || !profile) {
      throw ApiError.internal('Failed to verify user tier for AML check', 'AML_PROFILE_LOOKUP_FAILED');
    }

    // Only apply daily limit to unverified users
    if (!profile.is_verified) {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);

      const { data: todayTxs, error: txErr } = await supabaseAdmin
        .from('transactions')
        .select('amount')
        .eq('sender_id', senderId)
        .eq('type', 'TRANSFER')
        .eq('status', 'COMPLETED')
        .gte('settled_at', startOfDay.toISOString());

      if (txErr) {
        logger.error({ err: txErr.message, senderId }, 'AML daily limit lookup failed');
        throw ApiError.internal('Failed to compute AML daily limit', 'AML_DAILY_LOOKUP_FAILED');
      }

      const dailyTotal = (todayTxs || []).reduce(
        (sum, tx) => sum + parseFloat(tx.amount),
        0
      );

      if (dailyTotal + amount > AML_DAILY_LIMIT_UNVERIFIED) {
        throw ApiError.badRequest(
          `This transfer would exceed the daily AML limit of $${AML_DAILY_LIMIT_UNVERIFIED.toFixed(2)} for unverified accounts (today's total: $${dailyTotal.toFixed(2)})`,
          'AML_DAILY_LIMIT_EXCEEDED'
        );
      }
    }
  }
}

module.exports = AmlService;
