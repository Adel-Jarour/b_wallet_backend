/**
 * AML (Anti-Money Laundering) & Account Status Validation Middleware
 * ===================================================================
 * Enforces transaction velocity constraints and account freeze controls
 * per NFR-COMP-002 and Sprint 9 specifications.
 *
 * Checks:
 * 1. Account Freeze Status: Blocks users with wallet status = 'FROZEN'
 * 2. Single-Transfer Threshold: $2,500.00 max
 * 3. Daily Cumulative Threshold: $10,000.00 max for unverified tiers
 */

const { supabaseAdmin } = require('../config/supabase');
const AmlService = require('../services/aml.service');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

/**
 * Express middleware to validate AML limits and account status before financial actions.
 */
async function validateAmlLimits(req, res, next) {
  try {
    const userId = req.userId;
    if (!userId) {
      return next(ApiError.unauthorized('Authentication required for AML validation', 'AUTH_REQUIRED'));
    }

    // 1. Check user's wallet status for administrative freeze
    const { data: wallet, error: walletErr } = await supabaseAdmin
      .from('wallets')
      .select('id, status')
      .eq('user_id', userId)
      .single();

    if (walletErr) {
      logger.error({ err: walletErr.message, userId }, 'AML middleware: wallet lookup failed');
      return next(ApiError.internal('Failed to verify wallet status for AML check', 'AML_CHECK_FAILED'));
    }

    if (wallet && wallet.status === 'FROZEN') {
      logger.warn({ userId, walletId: wallet.id }, 'AML middleware: blocked transaction on FROZEN wallet');
      return next(ApiError.forbidden(
        'Your wallet has been restricted from performing transactions. Please contact support.',
        'ACCOUNT_FROZEN'
      ));
    }

    // 2. If an amount is specified in the request body, validate against AML thresholds
    const rawAmount = req.body?.amount;
    if (rawAmount !== undefined && rawAmount !== null) {
      const amount = parseFloat(rawAmount);
      if (!isNaN(amount) && amount > 0) {
        await AmlService.validateTransferLimits(userId, amount);
      }
    }

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  validateAmlLimits
};
