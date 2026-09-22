/**
 * Standardized Custom API Error class for B-Wallet
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status code
   * @param {string} message - Human-readable error description
   * @param {string} [errorCode='INTERNAL_ERROR'] - Machine-readable error identifier
   * @param {any} [details=null] - Additional validation or contextual details
   * @param {boolean} [isOperational=true] - Indicates if this is a known operational error
   */
  constructor(statusCode, message, errorCode = 'INTERNAL_ERROR', details = null, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, errorCode = 'BAD_REQUEST', details = null) {
    return new ApiError(400, message, errorCode, details);
  }

  static unauthorized(message = 'Unauthorized access', errorCode = 'UNAUTHORIZED', details = null) {
    return new ApiError(401, message, errorCode, details);
  }

  static forbidden(message = 'Access forbidden', errorCode = 'FORBIDDEN', details = null) {
    return new ApiError(403, message, errorCode, details);
  }

  static notFound(message = 'Requested resource not found', errorCode = 'NOT_FOUND', details = null) {
    return new ApiError(404, message, errorCode, details);
  }

  static conflict(message, errorCode = 'CONFLICT', details = null) {
    return new ApiError(409, message, errorCode, details);
  }

  static locked(message = 'Resource is locked', errorCode = 'LOCKED', details = null) {
    return new ApiError(423, message, errorCode, details);
  }

  static internal(message = 'Internal server error', errorCode = 'INTERNAL_SERVER_ERROR', details = null) {
    return new ApiError(500, message, errorCode, details, false);
  }
}

module.exports = ApiError;
