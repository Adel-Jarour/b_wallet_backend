const ApiError = require('../../src/utils/ApiError');

describe('Unit: ApiError Utility Class', () => {
  test('should construct standard ApiError with defaults', () => {
    const error = new ApiError(400, 'Invalid request', 'BAD_REQUEST', { field: 'email' });
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('Invalid request');
    expect(error.errorCode).toBe('BAD_REQUEST');
    expect(error.details).toEqual({ field: 'email' });
    expect(error.isOperational).toBe(true);
    expect(error.stack).toBeDefined();
  });

  test('static badRequest should return 400 status', () => {
    const error = ApiError.badRequest('Missing field');
    expect(error.statusCode).toBe(400);
    expect(error.errorCode).toBe('BAD_REQUEST');
  });

  test('static unauthorized should return 401 status', () => {
    const error = ApiError.unauthorized('Invalid JWT');
    expect(error.statusCode).toBe(401);
    expect(error.errorCode).toBe('UNAUTHORIZED');
  });

  test('static forbidden should return 403 status', () => {
    const error = ApiError.forbidden('Access denied');
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe('FORBIDDEN');
  });

  test('static notFound should return 404 status', () => {
    const error = ApiError.notFound('Wallet not found');
    expect(error.statusCode).toBe(404);
    expect(error.errorCode).toBe('NOT_FOUND');
  });

  test('static locked should return 423 status for PIN lockouts', () => {
    const error = ApiError.locked('PIN temporarily locked for 15 minutes');
    expect(error.statusCode).toBe(423);
    expect(error.errorCode).toBe('LOCKED');
  });

  test('static internal should return 500 status with isOperational=false', () => {
    const error = ApiError.internal('Database crash');
    expect(error.statusCode).toBe(500);
    expect(error.isOperational).toBe(false);
  });
});
