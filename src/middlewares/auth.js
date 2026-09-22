const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

/**
 * Express middleware that validates the Supabase Auth JWT token
 * passed in the `Authorization: Bearer <token>` header.
 *
 * Populates `req.user` with the verified identity.
 * Downstream handlers MUST rely on `req.user.id` and NEVER trust client-supplied user IDs.
 */
async function authenticateJwt(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return next(
        ApiError.unauthorized(
          'Missing Authorization header. Expected format: Authorization: Bearer <token>',
          'AUTH_HEADER_MISSING'
        )
      );
    }

    const parts = authHeader.trim().split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      return next(
        ApiError.unauthorized(
          'Malformed Authorization header. Format must be: Bearer <token>',
          'AUTH_HEADER_MALFORMED'
        )
      );
    }

    const token = parts[1];

    if (!token) {
      return next(
        ApiError.unauthorized('Authentication token cannot be empty', 'TOKEN_EMPTY')
      );
    }

    // Verify token using Supabase Auth
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return next(
        ApiError.unauthorized(
          error ? error.message : 'Invalid or expired session token',
          'TOKEN_INVALID'
        )
      );
    }

    // Attach authenticated user identity to request context
    req.user = {
      id: user.id,
      email: user.email,
      phone: user.phone || null,
      user_metadata: user.user_metadata || {},
      app_metadata: user.app_metadata || {},
      role: user.role
    };

    req.userId = user.id;

    next();
  } catch (err) {
    logger.error({ err: err.message }, 'Unexpected authentication error in JWT middleware');
    next(ApiError.unauthorized('Authentication verification failed', 'AUTH_ERROR'));
  }
}

module.exports = {
  authenticateJwt,
  authenticate: authenticateJwt
};
