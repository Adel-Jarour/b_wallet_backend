const crypto = require('crypto');
const { env } = require('../config/env');
const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('./ApiError');
const logger = require('../config/logger');

const TICKET_TTL_MS = 5 * 60 * 1000; // 5 minutes as specified by the SRS / Sprint plan

/**
 * Derives a secret signing key for transaction authorization tickets.
 */
function getSigningSecret() {
  return process.env.TRANSACTION_TICKET_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Computes a deterministic SHA-256 hash of transfer parameters for ticket parameter binding.
 *
 * @param {object} params - { amount, receiverId }
 * @returns {string} Hex hash string
 */
function hashTransferParams(params) {
  if (!params) return null;
  const canonical = `${params.amount || ''}:${params.receiverId || params.receiverPhone || params.receiverEmail || ''}`;
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Issues a cryptographically signed transaction authorization ticket.
 * Valid for 5 minutes after successful PIN verification.
 * Includes unique JTI to enable single-use enforcement and replay protection.
 *
 * @param {string} userId - Authenticated user UUID
 * @param {object} [options] - Optional ticket options (e.g. transfer binding)
 * @returns {string} Signed transaction ticket token
 */
function issueTransactionTicket(userId, options = {}) {
  const jti = crypto.randomUUID();

  const payload = {
    jti,
    userId,
    purpose: 'TRANSACTION',
    authorizedAt: Date.now(),
    expiresAt: Date.now() + TICKET_TTL_MS
  };

  if (options.boundTransferParams) {
    payload.boundTransferHash = hashTransferParams(options.boundTransferParams);
  }

  const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payloadEncoded)
    .digest('base64url');

  return `${payloadEncoded}.${signature}`;
}

/**
 * Validates a transaction authorization ticket signature, user binding, and expiration.
 *
 * @param {string} ticket - The ticket token
 * @param {string} expectedUserId - Expected user ID that must match ticket payload
 * @param {object} [options] - Verification options (e.g. transferHash)
 * @returns {{ valid: boolean, payload?: any, error?: string }}
 */
function verifyTransactionTicket(ticket, expectedUserId, options = {}) {
  if (!ticket || typeof ticket !== 'string') {
    return { valid: false, error: 'Transaction ticket is required' };
  }

  const parts = ticket.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Malformed transaction ticket' };
  }

  const [payloadEncoded, signature] = parts;

  // Constant-time signature verification
  const expectedSignature = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payloadEncoded)
    .digest('base64url');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, error: 'Invalid ticket signature' };
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8'));

    if (payload.userId !== expectedUserId) {
      return { valid: false, error: 'Ticket was issued to a different user' };
    }

    if (payload.purpose !== 'TRANSACTION') {
      return { valid: false, error: 'Invalid ticket purpose' };
    }

    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: 'Transaction ticket has expired (5-minute validity window exceeded)' };
    }

    if (payload.boundTransferHash && options.transferParams) {
      const currentHash = hashTransferParams(options.transferParams);
      if (payload.boundTransferHash !== currentHash) {
        return { valid: false, error: 'Transaction ticket is not authorized for these transfer parameters' };
      }
    }

    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: 'Invalid ticket payload encoding' };
  }
}

/**
 * Verifies AND consumes a transaction authorization ticket (enforces single-use).
 * If the ticket has already been consumed, an ApiError (HTTP 401) is thrown.
 *
 * @param {string} ticket - The ticket token
 * @param {string} expectedUserId - Expected user ID that must match ticket payload
 * @param {object} [options] - Verification options
 * @returns {Promise<{ valid: boolean, payload: any }>}
 */
async function consumeTransactionTicket(ticket, expectedUserId, options = {}) {
  const result = verifyTransactionTicket(ticket, expectedUserId, options);
  if (!result.valid) {
    throw ApiError.unauthorized(
      `Transaction authorization failed: ${result.error}`,
      'TICKET_INVALID'
    );
  }

  const payload = result.payload;

  // Check if ticket (JTI) was already used
  if (payload.jti) {
    const { data: existing, error: checkErr } = await supabaseAdmin
      .from('used_transaction_tickets')
      .select('ticket_id')
      .eq('ticket_id', payload.jti)
      .maybeSingle();

    if (checkErr) {
      logger.error({ err: checkErr.message, jti: payload.jti }, 'Error checking ticket consumption');
    }

    if (existing) {
      throw ApiError.unauthorized(
        'Transaction ticket has already been used and cannot be reused (single-use authorization violated)',
        'TICKET_ALREADY_USED'
      );
    }

    // Mark ticket as consumed in public.used_transaction_tickets
    const { error: insertErr } = await supabaseAdmin
      .from('used_transaction_tickets')
      .insert({
        ticket_id: payload.jti,
        user_id: expectedUserId,
        purpose: payload.purpose || 'TRANSACTION',
        expires_at: new Date(payload.expiresAt).toISOString()
      });

    if (insertErr) {
      if (insertErr.code === '23505') {
        // Concurrent race condition: another request just consumed this ticket
        throw ApiError.unauthorized(
          'Transaction ticket has already been used and cannot be reused (single-use authorization violated)',
          'TICKET_ALREADY_USED'
        );
      }
      logger.error({ err: insertErr.message, jti: payload.jti }, 'Failed to record used ticket');
    }
  }

  return result;
}

module.exports = {
  issueTransactionTicket,
  verifyTransactionTicket,
  consumeTransactionTicket,
  hashTransferParams,
  TICKET_TTL_MS
};
