/**
 * Sensitivity-Aware Rate Limiting Middleware
 * ===========================================
 * Implements in-memory sliding-window rate limiting per endpoint sensitivity:
 *
 * 1. Global API Limiter: 100 requests / 15 minutes per IP
 * 2. Auth Limiter: 10 requests / 15 minutes per IP (login, register)
 * 3. PIN Operations Limiter: 5 requests / 1 minute per IP/user (anti-brute-force)
 * 4. Financial Limiter: 10 requests / 1 minute per user (transfers, payments, top-up)
 * 5. Device Token Limiter: 10 requests / 1 minute per user
 * 6. Webhook Limiter: 120 requests / 1 minute per IP
 *
 * Complies with NFR-SEC-004 and Sprint 9 specifications.
 */

const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

class SlidingWindowRateLimiter {
  /**
   * @param {object} options
   * @param {number} options.windowMs - Time window in milliseconds
   * @param {number} options.max - Maximum allowed requests in windowMs
   * @param {string} options.name - Descriptive name for the limiter
   * @param {Function} [options.keyGenerator] - Custom key generator function (req) => string
   * @param {string} [options.message] - Custom error message
   */
  constructor({ windowMs, max, name = 'rate-limiter', keyGenerator, message }) {
    this.windowMs = windowMs;
    this.max = max;
    this.name = name;
    this.keyGenerator = keyGenerator || ((req) => req.ip || req.connection.remoteAddress || 'unknown');
    this.message = message || `Too many requests for ${name}. Please try again later.`;
    this.hits = new Map(); // key -> Array of timestamps

    // Periodic sweep to prevent memory leak
    this.cleanupInterval = setInterval(() => this.cleanup(), Math.max(60000, this.windowMs));
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter(ts => now - ts < this.windowMs);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, valid);
      }
    }
  }

  reset() {
    this.hits.clear();
  }

  middleware() {
    return (req, res, next) => {
      // In test mode, allow normal tests to bypass rate limiting unless explicitly testing rate limits
      if (process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
        return next();
      }

      const key = `${this.name}:${this.keyGenerator(req)}`;
      const now = Date.now();
      const windowStart = now - this.windowMs;

      let timestamps = this.hits.get(key) || [];
      // Retain only timestamps within the sliding window
      timestamps = timestamps.filter(ts => ts > windowStart);

      if (timestamps.length >= this.max) {
        const oldestTimestamp = timestamps[0];
        const retryAfterSeconds = Math.max(1, Math.ceil((oldestTimestamp + this.windowMs - now) / 1000));

        res.setHeader('Retry-After', String(retryAfterSeconds));
        res.setHeader('X-RateLimit-Limit', String(this.max));
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', String(Math.ceil((oldestTimestamp + this.windowMs) / 1000)));

        logger.warn({
          limiter: this.name,
          key,
          retryAfterSeconds,
          url: req.originalUrl
        }, 'Rate limit exceeded');

        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: this.message,
            retryAfter: retryAfterSeconds
          }
        });
      }

      // Record hit
      timestamps.push(now);
      this.hits.set(key, timestamps);

      res.setHeader('X-RateLimit-Limit', String(this.max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, this.max - timestamps.length)));

      next();
    };
  }
}

// 1. Global API Limiter: 100 requests per 15 minutes per IP
const globalLimiter = new SlidingWindowRateLimiter({
  name: 'global',
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests across the API. Please try again in 15 minutes.'
});

// 2. Auth Limiter: 10 requests per 15 minutes per IP
const authLimiter = new SlidingWindowRateLimiter({
  name: 'auth',
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many authentication attempts. Please try again in 15 minutes.'
});

// 3. PIN Limiter: 5 requests per 1 minute per IP/user (anti-brute-force)
const pinLimiter = new SlidingWindowRateLimiter({
  name: 'pin',
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.userId || req.ip || 'pin-unknown',
  message: 'Too many PIN verification attempts. Please wait 1 minute before trying again.'
});

// 4. Financial Limiter: 10 requests per 1 minute per user
const financialLimiter = new SlidingWindowRateLimiter({
  name: 'financial',
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.userId || req.ip || 'fin-unknown',
  message: 'Transaction rate limit exceeded. Please wait a moment before submitting another transaction.'
});

// 5. Device Token Limiter: 10 requests per 1 minute per user
const deviceTokenLimiter = new SlidingWindowRateLimiter({
  name: 'device-token',
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.userId || req.ip || 'device-unknown',
  message: 'Too many device token registration requests.'
});

// 6. Webhook Limiter: 120 requests per 1 minute per IP
const webhookLimiter = new SlidingWindowRateLimiter({
  name: 'webhook',
  windowMs: 60 * 1000,
  max: 120,
  message: 'Webhook intake rate limit exceeded.'
});

function resetAllLimiters() {
  globalLimiter.reset();
  authLimiter.reset();
  pinLimiter.reset();
  financialLimiter.reset();
  deviceTokenLimiter.reset();
  webhookLimiter.reset();
}

module.exports = {
  SlidingWindowRateLimiter,
  globalLimiter: globalLimiter.middleware(),
  authLimiter: authLimiter.middleware(),
  pinLimiter: pinLimiter.middleware(),
  financialLimiter: financialLimiter.middleware(),
  deviceTokenLimiter: deviceTokenLimiter.middleware(),
  webhookLimiter: webhookLimiter.middleware(),
  resetAllLimiters,
  _limiters: {
    global: globalLimiter,
    auth: authLimiter,
    pin: pinLimiter,
    financial: financialLimiter,
    deviceToken: deviceTokenLimiter,
    webhook: webhookLimiter
  }
};
