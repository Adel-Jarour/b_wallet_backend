const request = require('supertest');
const app = require('../../src/app');
const { supabaseAdmin } = require('../../src/config/supabase');

describe('Integration: Authentication & Session Routes (/api/v1/auth)', () => {
  const testUsersToCleanup = [];
  const testEmail = `auth_test_${Date.now()}@bwallet.dev`;
  const testPassword = 'Password123!';
  let createdUserId;
  let userAccessToken;
  let userRefreshToken;

  afterAll(async () => {
    // Cleanup created test users
    for (const id of testUsersToCleanup) {
      try {
        await supabaseAdmin.from('wallets').delete().eq('user_id', id);
        await supabaseAdmin.from('profiles').delete().eq('id', id);
        await supabaseAdmin.auth.admin.deleteUser(id);
      } catch (err) {
        // Ignore cleanup failures
      }
    }
  }, 20000);

  describe('POST /api/v1/auth/register', () => {
    test('should reject registration when password is weak (<8 chars, no special char)', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'weak@bwallet.dev',
          password: 'weak',
          firstName: 'Weak',
          lastName: 'User'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should successfully register a new user and auto-provision profile + wallet', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          firstName: 'Adel',
          lastName: 'FinTech',
          phoneNumber: '+15551234567'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user).toBeDefined();
      expect(response.body.data.user.email).toBe(testEmail);
      expect(response.body.data.profile).toBeDefined();
      expect(response.body.data.profile.first_name).toBe('Adel');

      // CRITICAL SECURITY ASSERTION: pin_hash must NEVER appear in API responses
      expect(response.body.data.profile.pin_hash).toBeUndefined();

      createdUserId = response.body.data.user.id;
      testUsersToCleanup.push(createdUserId);

      // Verify wallet was auto-provisioned with $0.00
      const { data: wallet } = await supabaseAdmin
        .from('wallets')
        .select('*')
        .eq('user_id', createdUserId)
        .single();

      expect(wallet).toBeTruthy();
      expect(wallet.currency).toBe('USD');
      expect(parseFloat(wallet.balance)).toBe(0.00);
    }, 15000);

    test('should reject registration with an existing email (409 Conflict)', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          firstName: 'Duplicate',
          lastName: 'User'
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
    }, 10000);
  });

  describe('POST /api/v1/auth/login', () => {
    test('should reject login with wrong password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword999!'
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    test('should successfully log in and return JWT session tokens', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.refreshToken).toBeDefined();
      expect(response.body.data.user.id).toBe(createdUserId);

      // Security check: pin_hash must not be present
      expect(response.body.data.profile.pin_hash).toBeUndefined();

      userAccessToken = response.body.data.accessToken;
      userRefreshToken = response.body.data.refreshToken;
    }, 10000);
  });

  describe('POST /api/v1/auth/refresh', () => {
    test('should successfully refresh session with valid refresh token', async () => {
      if (!userRefreshToken) return;

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: userRefreshToken
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
    }, 10000);

    test('should reject invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: 'invalid-refresh-token-value'
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Password Recovery & OTP Cooldown (/password-recovery)', () => {
    test('should request password recovery and enforce 60-second cooldown on immediate re-request', async () => {
      // First request -> should succeed
      const firstReq = await request(app)
        .post('/api/v1/auth/password-recovery/request')
        .send({ email: testEmail });

      expect(firstReq.status).toBe(200);
      expect(firstReq.body.success).toBe(true);
      expect(firstReq.body.data.cooldownSeconds).toBe(60);

      // Immediate second request -> MUST be rejected due to 60-second cooldown (FR-AUTH-003)
      const secondReq = await request(app)
        .post('/api/v1/auth/password-recovery/request')
        .send({ email: testEmail });

      expect(secondReq.status).toBe(400);
      expect(secondReq.body.success).toBe(false);
      expect(secondReq.body.error.code).toBe('OTP_COOLDOWN');
      expect(secondReq.body.error.details.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }, 10000);
  });

  describe('POST /api/v1/auth/logout', () => {
    test('should reject logout without Authorization header', async () => {
      const response = await request(app).post('/api/v1/auth/logout');
      expect(response.status).toBe(401);
    });

    test('should successfully logout authenticated user', async () => {
      if (!userAccessToken) return;

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${userAccessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
