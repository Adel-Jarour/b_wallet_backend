const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../config/logger');

const IDEMPOTENCY_KEY_HEADER = 'x-idempotency-key';

/**
 * Validates that a string is a UUIDv4.
 * @param {string} str
 * @returns {boolean}
 */
function isUUIDv4(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Generates a SHA-256 hash of the request body for conflict detection.
 * If an idempotency key is reused with a different payload, the request is rejected.
 *
 * @param {object} body - Request body object
 * @returns {string} Lowercase hex hash
 */
function hashRequestBody(body) {
  const canonical = JSON.stringify(body, Object.keys(body).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Idempotency middleware for financial mutations.
 *
 * Behavior:
 *   1. Requires X-Idempotency-Key header (UUIDv4).
 *   2. If key seen before and response cached → returns cached response.
 *   3. If key seen but no cached response → request is in-flight → returns 409.
 *   4. If key is new → inserts placeholder, proceeds; response is cached on completion.
 *
 * Registered in idempotency_keys table keyed by (key, user_id).
 * Keys expire after 24 hours (enforced by the table schema's expires_at column).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function checkIdempotency(req, res, next) {
  const rawKey = req.headers[IDEMPOTENCY_KEY_HEADER];

  if (!rawKey) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'IDEMPOTENCY_KEY_MISSING',
        message: 'X-Idempotency-Key header is required for this endpoint'
      }
    });
  }

  if (!isUUIDv4(rawKey)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'IDEMPOTENCY_KEY_INVALID',
        message: 'X-Idempotency-Key must be a valid UUIDv4'
      }
    });
  }

  const userId = req.userId;
  const endpoint = `${req.method} ${req.path}`;
  const requestHash = hashRequestBody(req.body);

  // ============================================================================
  // Look up existing record for this (key, user_id) pair
  // ============================================================================
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from('idempotency_keys')
    .select('id, response_status, response_body, request_hash, expires_at')
    .eq('key', rawKey)
    .eq('user_id', userId)
    .maybeSingle();

  if (lookupErr) {
    logger.error({ err: lookupErr.message, userId, key: rawKey }, 'Idempotency key lookup failed');
    return next(); // Fail open: allow the request to proceed (do not block on infra errors)
  }

  if (existing) {
    // Key has been seen before
    const isExpired = new Date(existing.expires_at) < new Date();

    if (isExpired) {
      // Expired key — treat as new (allow reuse per spec: keys expire after 24h)
      await supabaseAdmin
        .from('idempotency_keys')
        .delete()
        .eq('id', existing.id);
    } else if (existing.response_body !== null) {
      // Cached response exists — return it immediately
      if (existing.request_hash && existing.request_hash !== requestHash) {
        // Same key, different payload → conflict
        return res.status(422).json({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_CONFLICT',
            message: 'This idempotency key was previously used with a different request payload'
          }
        });
      }

      logger.info({ userId, key: rawKey }, 'Idempotency cache hit — returning cached response');

      // Replay the original response
      return res.status(existing.response_status).json(existing.response_body);
    } else {
      // No response cached yet — in-flight duplicate
      return res.status(409).json({
        success: false,
        error: {
          code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
          message: 'A request with this idempotency key is already being processed'
        }
      });
    }
  }

  // ============================================================================
  // New key — insert placeholder (no response_body yet = in-flight marker)
  // ============================================================================
  const { error: insertErr } = await supabaseAdmin
    .from('idempotency_keys')
    .insert({
      key: rawKey,
      user_id: userId,
      endpoint,
      request_hash: requestHash
    });

  if (insertErr) {
    // Unique constraint violation means a concurrent request beat us
    if (insertErr.code === '23505') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
          message: 'A request with this idempotency key is already being processed'
        }
      });
    }

    logger.error({ err: insertErr.message, userId, key: rawKey }, 'Failed to insert idempotency key');
    return next(); // Fail open
  }

  // Attach idempotency key and caching helper to req for use in controllers
  req.idempotencyKey = rawKey;
  req.cacheIdempotencyResponse = async (statusCode, responseBody) => {
    const { error: updateErr } = await supabaseAdmin
      .from('idempotency_keys')
      .update({
        response_status: statusCode,
        response_body: responseBody
      })
      .eq('key', rawKey)
      .eq('user_id', userId);

    if (updateErr) {
      logger.error({ err: updateErr.message, key: rawKey }, 'Failed to cache idempotency response');
    }
  };

  // If request ends with an error (4xx/5xx) and no response was cached, remove the in-flight lock
  res.on('finish', async () => {
    if (res.statusCode >= 400) {
      try {
        await supabaseAdmin
          .from('idempotency_keys')
          .delete()
          .eq('key', rawKey)
          .eq('user_id', userId)
          .is('response_body', null);
      } catch (err) {
        logger.warn({ err: err.message, key: rawKey }, 'Failed to clean up failed idempotency key');
      }
    }
  });

  next();
}

module.exports = { checkIdempotency };
