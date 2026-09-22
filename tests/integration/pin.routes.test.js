const request = require('supertest');
const app = require('../../src/app');
const { supabaseAdmin } = require('../../src/config/supabase');
const { verifyTransactionTicket } = require('../../src/utils/ticket.util');

describe('Integration: Transaction PIN Security Engine Routes (/api/v1/auth/pin)', () => {
  const testUsersToCleanup = [];
  const testEmail = `pin_test_${Date.now()}@bwallet.dev`;
  const testPassword = 'Password123!';
  let userId;
  let userAccessToken;

  beforeAll(async () => {
    // 1. Create a dedicated test user
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: 'PinTester', last_name: 'User' }
    });

    if (error) throw new Error(`Failed to create test user: ${error.message}`);
    userId = data.user.id;
    testUsersToCleanup.push(userId);

    // 2. Sign in via API to obtain a valid JWT access token
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });

    userAccessToken = loginRes.body.data.accessToken;
  }, 20000);

  afterAll(async () => {
    for (const id of testUsersToCleanup) {
      try {
        await supabaseAdmin.from('wallets').delete().eq('user_id', id);
        await supabaseAdmin.from('profiles').delete().eq('id', id);
        await supabaseAdmin.auth.admin.deleteUser(id);
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  }, 20000);

  describe('Unauthenticated Access Control', () => {
    test('should reject GET /status without valid JWT (401)', async () => {
      const res = await request(app).get('/api/v1/auth/pin/status');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('should reject POST /setup without valid JWT (401)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/setup')
        .send({ pin: '123456', confirmPin: '123456' });
      expect(res.status).toBe(401);
    });

    test('should reject POST /verify without valid JWT (401)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/verify')
        .send({ pin: '123456' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/pin/status (Initial)', () => {
    test('should return hasPin: false before setup', async () => {
      const res = await request(app)
        .get('/api/v1/auth/pin/status')
        .set('Authorization', `Bearer ${userAccessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hasPin).toBe(false);
      expect(res.body.data.isLocked).toBe(false);
      expect(res.body.data.remainingAttempts).toBe(3);

      // CRITICAL SECURITY ASSERTION
      expect(res.body.data.pin_hash).toBeUndefined();
    });
  });

  describe('POST /api/v1/auth/pin/setup', () => {
    test('should reject PINs that are not exactly 6 digits', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/setup')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ pin: '12345', confirmPin: '12345' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject when pin and confirmPin do not match', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/setup')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ pin: '123456', confirmPin: '654321' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should successfully set up a 6-digit PIN with Argon2id', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/setup')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ pin: '456789', confirmPin: '456789' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/success/i);

      // Verify in database that pin_hash is an Argon2id hash (never plaintext)
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('pin_hash')
        .eq('id', userId)
        .single();

      expect(profile.pin_hash).toBeDefined();
      expect(profile.pin_hash).not.toBe('456789');
      expect(profile.pin_hash).toMatch(/^\$argon2id\$/);
    });

    test('should reject subsequent setup attempts (409 Conflict)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/setup')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ pin: '456789', confirmPin: '456789' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PIN_ALREADY_EXISTS');
    });
  });

  describe('POST /api/v1/auth/pin/verify & 15-Minute Lockout', () => {
    test('1st failed attempt should return 400 with 2 remaining attempts', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/verify')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ pin: '000000' }); // wrong PIN

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INCORRECT_PIN');
      expect(res.body.error.details.remainingAttempts).toBe(2);
    });

    test('2nd failed attempt should return 400 with 1 remaining attempt', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/verify')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ pin: '000000' }); // wrong PIN

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INCORRECT_PIN');
      expect(res.body.error.details.remainingAttempts).toBe(1);
    });

    test('3rd failed attempt MUST lock transaction capability for 15 minutes (HTTP 423 Locked)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/verify')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ pin: '000000' }); // 3rd wrong PIN

      expect(res.status).toBe(423); // HTTP 423 Locked
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PIN_LOCKED');
      expect(res.body.error.details.retryAfterSeconds).toBeGreaterThanOrEqual(890);
      expect(res.body.error.details.lockedUntil).toBeDefined();

      // Verify database state: pin_locked_until is ~15 minutes in the future
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('pin_failed_attempts, pin_locked_until')
        .eq('id', userId)
        .single();

      expect(profile.pin_failed_attempts).toBeGreaterThanOrEqual(3);
      expect(new Date(profile.pin_locked_until) > new Date()).toBe(true);
    });

    test('subsequent attempt while locked must reject immediately with HTTP 423', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/verify')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ pin: '456789' }); // even correct PIN must be rejected when locked!

      expect(res.status).toBe(423);
      expect(res.body.error.code).toBe('PIN_LOCKED');
      expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    });

    test('resetting lockout via administrative reset allows successful verification and issues 5-min ticket', async () => {
      // Clear lockout directly in DB to simulate lockout expiry
      await supabaseAdmin
        .from('profiles')
        .update({ pin_locked_until: null, pin_failed_attempts: 0 })
        .eq('id', userId);

      // Now submit the correct PIN
      const res = await request(app)
        .post('/api/v1/auth/pin/verify')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ pin: '456789' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.authorized).toBe(true);
      expect(res.body.data.ticket).toBeDefined();
      expect(res.body.data.expiresInSeconds).toBe(300); // 5 minutes

      // Verify the issued ticket
      const ticketVerification = verifyTransactionTicket(res.body.data.ticket, userId);
      expect(ticketVerification.valid).toBe(true);
      expect(ticketVerification.payload.userId).toBe(userId);
      expect(ticketVerification.payload.purpose).toBe('TRANSACTION');

      // Verify failed attempts counter was reset to 0
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('pin_failed_attempts, pin_locked_until')
        .eq('id', userId)
        .single();

      expect(profile.pin_failed_attempts).toBe(0);
      expect(profile.pin_locked_until).toBeNull();
    });
  });

  describe('POST /api/v1/auth/pin/change', () => {
    test('should reject when new PIN is identical to current PIN', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/change')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({
          currentPin: '456789',
          newPin: '456789',
          confirmNewPin: '456789'
        });

      expect(res.status).toBe(400);
    });

    test('should reject when current PIN is incorrect', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/change')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({
          currentPin: '999999',
          newPin: '112233',
          confirmNewPin: '112233'
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INCORRECT_PIN');
    });

    test('should successfully change PIN with valid credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/change')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({
          currentPin: '456789',
          newPin: '112233',
          confirmNewPin: '112233'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Old PIN must now fail
      const oldPinRes = await request(app)
        .post('/api/v1/auth/pin/verify')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ pin: '456789' });

      expect(oldPinRes.status).toBe(400);

      // New PIN must now succeed
      const newPinRes = await request(app)
        .post('/api/v1/auth/pin/verify')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ pin: '112233' });

      expect(newPinRes.status).toBe(200);
      expect(newPinRes.body.data.authorized).toBe(true);
    }, 20000);
  });
});
