const ApiError = require('../utils/ApiError');

/**
 * Creates an Express middleware to validate request data against a Zod schema.
 *
 * @param {import('zod').ZodSchema} schema - Zod validation schema
 * @param {'body' | 'query' | 'params'} [source='body'] - Request property to validate
 * @returns {import('express').RequestHandler}
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const formattedErrors = result.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message
      }));

      return next(
        ApiError.badRequest(
          `Validation failed for ${source}: ${formattedErrors.map(e => e.message).join('; ')}`,
          'VALIDATION_ERROR',
          formattedErrors
        )
      );
    }

    // Assign sanitized / parsed data back to request
    req[source] = result.data;
    next();
  };
}

module.exports = validate;
