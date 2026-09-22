/**
 * Request Input Sanitizer & Prototype Pollution Protection Middleware
 * ====================================================================
 * Inspects all incoming request bodies, query strings, parameters, and raw JSON:
 * 1. Blocks prototype pollution attempts (__proto__, constructor, prototype)
 * 2. Rejects null byte injection attacks (\0, \u0000)
 * 3. Sanitizes deep JSON objects and query parameters
 */

const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

const PROHIBITED_KEYS = ['__proto__', 'constructor', 'prototype'];

function checkObjectSecurity(obj, path = '') {
  if (!obj || typeof obj !== 'object') {
    return;
  }

  for (const key of Object.getOwnPropertyNames(obj)) {
    if (PROHIBITED_KEYS.includes(key)) {
      throw ApiError.badRequest(
        'Malformed request: prohibited object properties detected',
        'SECURITY_PROTOTYPE_POLLUTION'
      );
    }

    const val = obj[key];
    if (typeof val === 'string' && (val.includes('\0') || val.includes('\u0000'))) {
      throw ApiError.badRequest(
        'Malformed request: null byte injection detected',
        'SECURITY_NULL_BYTE'
      );
    }

    if (typeof val === 'object' && val !== null) {
      checkObjectSecurity(val, path ? `${path}.${key}` : key);
    }
  }
}

/**
 * Express middleware for deep input sanitization and security inspection.
 */
function requestSanitizer(req, res, next) {
  try {
    // 1. Inspect raw body if captured during JSON parsing
    if (req.rawBody) {
      const rawStr = req.rawBody.toString('utf-8');
      if (rawStr.includes('"__proto__"') || rawStr.includes('"prototype"')) {
        throw ApiError.badRequest(
          'Malformed request: prohibited object properties detected',
          'SECURITY_PROTOTYPE_POLLUTION'
        );
      }
      if (rawStr.includes('\\u0000') || rawStr.includes('\0')) {
        throw ApiError.badRequest(
          'Malformed request: null byte injection detected',
          'SECURITY_NULL_BYTE'
        );
      }
    }

    // 2. Inspect parsed query, params, and body objects
    if (req.body && typeof req.body === 'object') {
      checkObjectSecurity(req.body);
    }
    if (req.query && typeof req.query === 'object') {
      checkObjectSecurity(req.query);
    }
    if (req.params && typeof req.params === 'object') {
      checkObjectSecurity(req.params);
    }
    next();
  } catch (err) {
    logger.warn({ err: err.message, ip: req.ip, path: req.path }, 'Input security inspection violation');
    next(err);
  }
}

module.exports = {
  requestSanitizer
};
