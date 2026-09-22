const { authenticateJwt } = require('../../src/middlewares/auth');
const { supabaseAdmin } = require('../../src/config/supabase');
const ApiError = require('../../src/utils/ApiError');

jest.mock('../../src/config/supabase', () => ({
  supabaseAdmin: {
    auth: {
      getUser: jest.fn()
    }
  }
}));

describe('Unit: authenticateJwt Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {}
    };
    res = {};
    next = jest.fn();
    jest.clearAllMocks();
  });

  test('should reject request when Authorization header is missing', async () => {
    await authenticateJwt(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ApiError);
    expect(error.statusCode).toBe(401);
    expect(error.errorCode).toBe('AUTH_HEADER_MISSING');
  });

  test('should reject request when Authorization header is not Bearer format', async () => {
    req.headers.authorization = 'Basic dXNlcjpwYXNz';

    await authenticateJwt(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ApiError);
    expect(error.statusCode).toBe(401);
    expect(error.errorCode).toBe('AUTH_HEADER_MALFORMED');
  });

  test('should reject request when token is empty', async () => {
    req.headers.authorization = 'Bearer ';

    await authenticateJwt(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ApiError);
    expect(error.statusCode).toBe(401);
  });

  test('should reject request when Supabase returns an error for token', async () => {
    req.headers.authorization = 'Bearer invalid-expired-token';
    supabaseAdmin.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'jwt expired' }
    });

    await authenticateJwt(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ApiError);
    expect(error.statusCode).toBe(401);
    expect(error.errorCode).toBe('TOKEN_INVALID');
  });

  test('should populate req.user and call next() when token is valid', async () => {
    req.headers.authorization = 'Bearer valid-jwt-token';
    const mockUser = {
      id: '11111111-2222-3333-4444-555555555555',
      email: 'test@bwallet.dev',
      phone: '+1234567890',
      user_metadata: { first_name: 'John' },
      role: 'authenticated'
    };

    supabaseAdmin.auth.getUser.mockResolvedValueOnce({
      data: { user: mockUser },
      error: null
    });

    await authenticateJwt(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(); // called with no error
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(mockUser.id);
    expect(req.user.email).toBe(mockUser.email);
    expect(req.userId).toBe(mockUser.id);
  });
});
