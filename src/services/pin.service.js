const argon2 = require('argon2');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const { issueTransactionTicket } = require('../utils/ticket.util');
const NotificationService = require('./notification.service');
const logger = require('../config/logger');

const MAX_FAILED_ATTEMPTS = 3;
const LOCKOUT_MINUTES = 15;

// OWASP Recommended Argon2id parameters for FinTech PIN hashing
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,       // 3 iterations
  parallelism: 4,    // 4 threads
  hashLength: 32     // 32-byte hash output
};

class PinService {
  /**
   * Hashes a 6-digit numeric PIN using Argon2id with a unique per-user cryptographic salt.
   *
   * @param {string} pin - Plaintext 6-digit PIN
   * @returns {Promise<string>} Encoded Argon2id hash string
   */
  static async hashPin(pin) {
    if (!pin || !/^\d{6}$/.test(pin)) {
      throw ApiError.badRequest('PIN must be exactly 6 numeric digits', 'INVALID_PIN_FORMAT');
    }

    const salt = crypto.randomBytes(16);
    return await argon2.hash(pin, {
      ...ARGON2_OPTIONS,
      salt
    });
  }

  /**
   * Constant-time verification of a PIN against its Argon2id hash.
   *
   * @param {string} hash - Stored Argon2id hash
   * @param {string} pin - Plaintext PIN to test
   * @returns {Promise<boolean>}
   */
  static async verifyPinHash(hash, pin) {
    if (!hash || !pin) return false;
    try {
      return await argon2.verify(hash, pin);
    } catch (err) {
      logger.error({ err: err.message }, 'Argon2 verification internal error');
      return false;
    }
  }

  /**
   * Retrieves user's PIN security status without revealing sensitive fields.
   *
   * @param {string} userId - User UUID
   * @returns {Promise<{ hasPin: boolean, isLocked: boolean, lockedUntil: string|null, retryAfterSeconds: number, remainingAttempts: number }>}
   */
  static async getPinStatus(userId) {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('pin_hash, pin_failed_attempts, pin_locked_until')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      throw ApiError.notFound('User profile not found', 'PROFILE_NOT_FOUND');
    }

    const now = new Date();
    const isLocked = Boolean(profile.pin_locked_until && new Date(profile.pin_locked_until) > now);
    const retryAfterSeconds = isLocked
      ? Math.max(0, Math.ceil((new Date(profile.pin_locked_until) - now) / 1000))
      : 0;

    const remainingAttempts = isLocked
      ? 0
      : Math.max(0, MAX_FAILED_ATTEMPTS - (profile.pin_failed_attempts || 0));

    return {
      hasPin: Boolean(profile.pin_hash),
      isLocked,
      lockedUntil: profile.pin_locked_until,
      retryAfterSeconds,
      remainingAttempts
    };
  }

  /**
   * Initial PIN setup.
   *
   * @param {string} userId - User UUID
   * @param {string} pin - 6-digit numeric PIN
   */
  static async setupPin(userId, pin) {
    // Check if user already has a PIN
    const { data: profile, error: fetchErr } = await supabaseAdmin
      .from('profiles')
      .select('pin_hash')
      .eq('id', userId)
      .single();

    if (fetchErr || !profile) {
      throw ApiError.notFound('User profile not found', 'PROFILE_NOT_FOUND');
    }

    if (profile.pin_hash) {
      throw ApiError.conflict(
        'Transaction PIN is already configured for this account. Use change PIN instead.',
        'PIN_ALREADY_EXISTS'
      );
    }

    const pinHash = await this.hashPin(pin);

    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({
        pin_hash: pinHash,
        pin_failed_attempts: 0,
        pin_locked_until: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateErr) {
      throw ApiError.internal('Failed to persist transaction PIN securely', 'DB_ERROR');
    }

    logger.info({ userId }, 'Transaction PIN successfully initialized for user');
    return { success: true, message: 'Transaction PIN set successfully' };
  }

  /**
   * Validates PIN, enforces 15-minute lock upon 3 consecutive failures,
   * resets attempt counters on success, and issues a 5-minute transaction ticket.
   *
   * @param {string} userId - User UUID
   * @param {string} pin - Plaintext 6-digit PIN
   * @returns {Promise<{ authorized: boolean, ticket: string, expiresInSeconds: number }>}
   */
  static async validateAndAuthorizePin(userId, pin) {
    if (!pin || !/^\d{6}$/.test(pin)) {
      throw ApiError.badRequest('PIN must be exactly 6 numeric digits', 'INVALID_PIN_FORMAT');
    }

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('pin_hash, pin_failed_attempts, pin_locked_until')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      throw ApiError.notFound('User profile not found', 'PROFILE_NOT_FOUND');
    }

    if (!profile.pin_hash) {
      throw ApiError.badRequest(
        'Transaction PIN has not been set up. Please set up your 6-digit PIN first.',
        'PIN_NOT_SET'
      );
    }

    const now = new Date();

    // 1. Check if user is currently in lockout
    if (profile.pin_locked_until && new Date(profile.pin_locked_until) > now) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((new Date(profile.pin_locked_until) - now) / 1000)
      );

      throw ApiError.locked(
        `Wallet transaction capability is locked due to consecutive failed PIN attempts. Try again in ${retryAfterSeconds} seconds.`,
        'PIN_LOCKED',
        {
          retryAfterSeconds,
          lockedUntil: profile.pin_locked_until
        }
      );
    }

    // 2. Verify PIN against stored Argon2id hash
    const isMatch = await this.verifyPinHash(profile.pin_hash, pin);

    // 3. Atomically update attempt state in PostgreSQL
    const { data: attemptRows, error: rpcErr } = await supabaseAdmin.rpc('record_pin_attempt', {
      p_user_id: userId,
      p_success: isMatch
    });

    if (rpcErr) {
      // Fallback manual update if RPC is unavailable
      logger.warn({ err: rpcErr.message }, 'record_pin_attempt RPC fallback to direct update');
      if (isMatch) {
        await supabaseAdmin
          .from('profiles')
          .update({ pin_failed_attempts: 0, pin_locked_until: null, updated_at: now.toISOString() })
          .eq('id', userId);
      } else {
        const newAttempts = (profile.pin_failed_attempts || 0) + 1;
        const lockedUntil = newAttempts >= MAX_FAILED_ATTEMPTS
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
          : null;
        await supabaseAdmin
          .from('profiles')
          .update({ pin_failed_attempts: newAttempts, pin_locked_until: lockedUntil, updated_at: now.toISOString() })
          .eq('id', userId);
      }
    }

    // 4. Handle Result
    if (!isMatch) {
      const updatedRow = Array.isArray(attemptRows) && attemptRows.length > 0 ? attemptRows[0] : null;
      const currentAttempts = updatedRow
        ? updatedRow.pin_failed_attempts
        : (profile.pin_failed_attempts || 0) + 1;

      if (currentAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntilTime = updatedRow?.pin_locked_until || new Date(Date.now() + 15 * 60 * 1000).toISOString();
        
        // Dispatch security notification (non-blocking)
        try {
          NotificationService.notifyPinLockout({ userId, lockedUntil: lockUntilTime });
        } catch (e) {
          logger.warn({ err: e.message, userId }, 'Failed to dispatch PIN lockout notification');
        }

        throw ApiError.locked(
          'Wallet transaction capability has been locked for 15 minutes due to 3 consecutive failed PIN attempts.',
          'PIN_LOCKED',
          {
            retryAfterSeconds: 15 * 60,
            lockedUntil: lockUntilTime
          }
        );
      }

      const remainingAttempts = Math.max(0, MAX_FAILED_ATTEMPTS - currentAttempts);
      throw ApiError.badRequest(
        `Incorrect PIN. ${remainingAttempts} attempt(s) remaining before wallet lockout.`,
        'INCORRECT_PIN',
        { remainingAttempts }
      );
    }

    // 5. Success -> Issue signed 5-minute transaction authorization ticket
    const ticket = issueTransactionTicket(userId);

    return {
      authorized: true,
      ticket,
      expiresInSeconds: 300,
      message: 'PIN verified successfully'
    };
  }

  /**
   * Changes an existing PIN after validating the current one.
   *
   * @param {string} userId - User UUID
   * @param {string} currentPin - Existing PIN
   * @param {string} newPin - New 6-digit PIN
   */
  static async changePin(userId, currentPin, newPin) {
    if (currentPin === newPin) {
      throw ApiError.badRequest('New PIN must be different from current PIN', 'PIN_UNCHANGED');
    }

    // Step 1: Validate current PIN (this will increment failed attempts or lock if invalid)
    await this.validateAndAuthorizePin(userId, currentPin);

    // Step 2: Hash new PIN with Argon2id
    const newHash = await this.hashPin(newPin);

    // Step 3: Update database
    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({
        pin_hash: newHash,
        pin_failed_attempts: 0,
        pin_locked_until: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateErr) {
      throw ApiError.internal('Failed to update transaction PIN', 'DB_ERROR');
    }

    logger.info({ userId }, 'Transaction PIN successfully changed');
    return { success: true, message: 'Transaction PIN changed successfully' };
  }
}

module.exports = PinService;
