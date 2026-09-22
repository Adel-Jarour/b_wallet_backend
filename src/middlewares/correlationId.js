const crypto = require('crypto');

/**
 * Middleware that ensures every incoming request has a unique correlation ID
 * for distributed tracing and structured log attribution.
 */
function correlationIdMiddleware(req, res, next) {
  const correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  next();
}

module.exports = correlationIdMiddleware;
