const request = require('supertest');
const app = require('../../src/app');
const { supabaseAdmin } = require('../../src/config/supabase');

describe('Integration: User Profile Routes (/api/v1/profile)', () => {
  const testUsersToCleanup = [];
  const testEmail = `profile_test_${Date.now()}@bwallet.dev`;
  const testPassword = 'Password123!';
  let userId;
  let userAccessToken;

  beforeAll(async () => {
    // 1. Create a test user
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: 'OriginalFirst', last_name: 'OriginalLast' }
    });

    if (error) throw new Error(`Failed to create test user: ${error.message}`);
    userId = data.user.id;
    testUsersToCleanup.push(userId);

    // 2. Set up a dummy PIN directly in DB so we can test that pin_hash is never exposed
    await supabaseAdmin
      .from('profiles')
      .update({ pin_hash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash$dummyhash' })
      .eq('id', userId);

    // 3. Log in to get access token
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
        // Ignore cleanup failures
      }
    }
  }, 20000);

  describe('GET /api/v1/profile/me', () => {
    test('should reject request without Bearer token (401)', async () => {
      const res = await request(app).get('/api/v1/profile/me');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('should return sanitized profile for authenticated user', async () => {
      const res = await request(app)
        .get('/api/v1/profile/me')
        .set('Authorization', `Bearer ${userAccessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(userId);
      expect(res.body.data.email).toBe(testEmail);
      expect(res.body.data.first_name).toBe('OriginalFirst');
      expect(res.body.data.last_name).toBe('OriginalLast');

      // CRITICAL SECURITY ASSERTION: pin_hash must NEVER appear in API response
      expect(res.body.data.pin_hash).toBeUndefined();
    });
  });

  describe('PATCH /api/v1/profile/me', () => {
    test('should reject update without Bearer token (401)', async () => {
      const res = await request(app)
        .patch('/api/v1/profile/me')
        .send({ firstName: 'Hacker' });

      expect(res.status).toBe(401);
    });

    test('should reject invalid date format (non-YYYY-MM-DD)', async () => {
      const res = await request(app)
        .patch('/api/v1/profile/me')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({ dateOfBirth: '01/12/1990' }); // invalid format

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should successfully update personal profile details and return sanitized profile', async () => {
      const res = await request(app)
        .patch('/api/v1/profile/me')
        .set('Authorization', `Bearer ${userAccessToken}`)
        .send({
          firstName: 'UpdatedFirst',
          lastName: 'UpdatedLast',
          phoneNumber: '+15559876543',
          dateOfBirth: '1995-05-15'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.first_name).toBe('UpdatedFirst');
      expect(res.body.data.last_name).toBe('UpdatedLast');
      expect(res.body.data.phone_number).toBe('+15559876543');
      expect(res.body.data.date_of_birth).toBe('1995-05-15');

      // CRITICAL SECURITY ASSERTION
      expect(res.body.data.pin_hash).toBeUndefined();

      // Verify directly in DB that details updated but pin_hash remained intact
      const { data: dbProfile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      expect(dbProfile.first_name).toBe('UpdatedFirst');
      expect(dbProfile.pin_hash).toBeDefined(); // Still exists in DB, just hidden from client
    });
  });
});
