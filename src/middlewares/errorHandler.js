const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const { env } = require('../config/env');

/**
 * Global centralized error handling middleware.
 */
function errorHandler(err, req, res, next) {
  let error = err;

  // Handle malformed JSON request bodies
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    error = ApiError.badRequest('Malformed JSON payload in request body', 'MALFORMED_JSON');
  }

  // Convert generic Error to ApiError if not already an instance
  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || 500;
    const message = error.message || 'An unexpected internal server error occurred';
    error = new ApiError(statusCode, message, 'INTERNAL_SERVER_ERROR', null, false);
  }

  const response = {
    success: false,
    error: {
      code: error.errorCode,
      message: error.message,
      details: error.details,
      correlationId: req.correlationId || null
    }
  };

  // Include stack trace only in development environment
  if (env.NODE_ENV === 'development') {
    response.error.stack = err.stack;
  }

  // Log error with correlation context
  if (error.statusCode >= 500) {
    logger.error({
      correlationId: req.correlationId,
      err: {
        message: err.message,
        stack: err.stack,
        code: error.errorCode
      },
      req: {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip
      }
    }, 'Server Error');
  } else {
    logger.warn({
      correlationId: req.correlationId,
      code: error.errorCode,
      message: error.message,
      statusCode: error.statusCode
    }, 'Client Error');
  }

  res.status(error.statusCode).json(response);
}

module.exports = errorHandler;
