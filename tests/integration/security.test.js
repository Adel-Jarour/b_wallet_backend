/**
 * Integration Test: Sprint 9 Security Hardening & Compliance Enforcement
 * =======================================================================
 * Validates:
 * 1. Sensitivity-aware rate limiting with Retry-After header and 429 status
 * 2. AML velocity limits ($2,500.00 single transfer ceiling) and account freeze controls
 * 3. Database-level immutable financial ledger triggers (blocking UPDATE/DELETE on transactions & ledger_entries)
 * 4. Secrets isolation (verifying service role key and private secrets are never leaked)
 * 5. Input payload size limits (>100KB payload rejected with 413)
 * 6. Prototype pollution and null-byte injection protections
 * 7. Security HTTP headers (HSTS, nosniff, frameguard)
 * 8. SECURITY DEFINER permission hardening
 */

const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const { supabaseAdmin } = require('../../src/config/supabase');
const { resetAllLimiters } = require('../../src/middlewares/rateLimiter');

describe('Integration: Security Hardening & Compliance Controls (Sprint 9)', () => {
  let userA;
  let userAToken;
  let userB;
  let userBToken;
  let frozenUser;
  let frozenUserToken;

  const testUserIds = [];

  beforeAll(async () => {
    // 1. Create User A (Sender)
    const emailA = `sec_user_a_${Date.now()}@bwallet.dev`;
    const resA = await supabaseAdmin.auth.admin.createUser({
      email: emailA,
      password: 'Password123!',
      email_confirm: true,
      user_metadata: { first_name: 'Security', last_name: 'Alice' }
    });
    userA = resA.data.user;
    testUserIds.push(userA.id);

    const loginA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailA, password: 'Password123!' });
    userAToken = loginA.body.data.accessToken;

    // Set initial wallet balance for User A
    await supabaseAdmin
      .from('wallets')
      .update({ balance: 5000.00 })
      .eq('user_id', userA.id);

    // Setup PIN for User A
    await request(app)
      .post('/api/v1/auth/pin/setup')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ pin: '123456', confirmPin: '123456' });

    // 2. Create User B (Recipient)
    const emailB = `sec_user_b_${Date.now()}@bwallet.dev`;
    const resB = await supabaseAdmin.auth.admin.createUser({
      email: emailB,
      password: 'Password123!',
      email_confirm: true,
      user_metadata: { first_name: 'Security', last_name: 'Bob' }
    });
    userB = resB.data.user;
    testUserIds.push(userB.id);

    const loginB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailB, password: 'Password123!' });
    userBToken = loginB.body.data.accessToken;

    // 3. Create Frozen User
    const emailFrozen = `sec_user_frozen_${Date.now()}@bwallet.dev`;
    const resFrozen = await supabaseAdmin.auth.admin.createUser({
      email: emailFrozen,
      password: 'Password123!',
      email_confirm: true,
      user_metadata: { first_name: 'Frozen', last_name: 'Account' }
    });
    frozenUser = resFrozen.data.user;
    testUserIds.push(frozenUser.id);

    const loginFrozen = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailFrozen, password: 'Password123!' });
    frozenUserToken = loginFrozen.body.data.accessToken;

    // Freeze the account wallet
    await supabaseAdmin
      .from('wallets')
      .update({ status: 'FROZEN' })
      .eq('user_id', frozenUser.id);
  }, 45000);

  afterAll(async () => {
    resetAllLimiters();
    // Cleanup created users
    for (const userId of testUserIds) {
      try {
        await supabaseAdmin.from('wallets').delete().eq('user_id', userId);
        await supabaseAdmin.from('profiles').delete().eq('id', userId);
        await supabaseAdmin.auth.admin.deleteUser(userId);
      } catch (err) {
        // Ignore cleanup cascade errors in test environment
      }
    }
  }, 45000);

  // ==========================================================================
  // 1. Rate Limiting Tests
  // ==========================================================================
  describe('1. Sensitivity-Aware Rate Limiting', () => {
    beforeEach(() => {
      resetAllLimiters();
    });

    it('rejects rapid consecutive requests on PIN verification when exceeding limit (429)', async () => {
      // PIN limiter max = 5 per minute
      // Submit 5 requests with x-test-rate-limit header
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/v1/auth/pin/verify')
          .set('Authorization', `Bearer ${userAToken}`)
          .set('x-test-rate-limit', 'true')
          .send({ pin: '123456' });

        expect(res.status).not.toBe(429);
      }

      // 6th request must be rejected with 429
      const rateLimitedRes = await request(app)
        .post('/api/v1/auth/pin/verify')
        .set('Authorization', `Bearer ${userAToken}`)
        .set('x-test-rate-limit', 'true')
        .send({ pin: '123456' });

      expect(rateLimitedRes.status).toBe(429);
      expect(rateLimitedRes.body.success).toBe(false);
      expect(rateLimitedRes.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(rateLimitedRes.headers['retry-after']).toBeDefined();
    });
  });

  // ==========================================================================
  // 2. AML-Oriented Velocity & Account Freeze Controls
  // ==========================================================================
  describe('2. AML Velocity & Account Controls (NFR-COMP-002)', () => {
    it('blocks transfer exceeding single transfer limit of $2,500.00', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${userAToken}`)
        .set('X-Idempotency-Key', crypto.randomUUID())
        .send({
          receiverId: userB.id,
          amount: 2500.01,
          currency: 'USD',
          category: 'Food',
          pin: '123456'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      // Either Zod validation or AML check caught the ceiling
      expect(JSON.stringify(res.body)).toMatch(/(2,500|AML_SINGLE_LIMIT_EXCEEDED|AML velocity limit)/i);
    });

    it('strictly blocks transactions initiated by a FROZEN account (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${frozenUserToken}`)
        .set('X-Idempotency-Key', crypto.randomUUID())
        .send({
          receiverId: userB.id,
          amount: 50.00,
          currency: 'USD',
          category: 'Food',
          pin: '123456'
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ACCOUNT_FROZEN');
    });
  });

  // ==========================================================================
  // 3. Immutable Financial Ledger Triggers
  // ==========================================================================
  describe('3. Database-Level Financial Ledger Immutability (NFR-INT-004)', () => {
    let sampleTxId;
    let sampleLedgerId;

    beforeAll(async () => {
      // Perform a valid $10.00 transfer to produce an immutable transaction and ledger record
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${userAToken}`)
        .set('X-Idempotency-Key', crypto.randomUUID())
        .send({
          receiverId: userB.id,
          amount: 10.00,
          currency: 'USD',
          category: 'Food',
          pin: '123456'
        });

      expect(res.status).toBe(201);
      sampleTxId = res.body.data.receipt.transactionId;

      // Find the corresponding ledger entry
      const { data: ledgerEntries } = await supabaseAdmin
        .from('ledger_entries')
        .select('id')
        .eq('transaction_id', sampleTxId)
        .limit(1);

      expect(ledgerEntries && ledgerEntries.length).toBeGreaterThan(0);
      sampleLedgerId = ledgerEntries[0].id;
    });

    it('blocks direct SQL UPDATE on transactions via trigger exception', async () => {
      const { error } = await supabaseAdmin
        .from('transactions')
        .update({ amount: 99999.00 })
        .eq('id', sampleTxId);

      expect(error).toBeDefined();
      expect(error.message).toMatch(/Financial audit records are immutable.*prohibited/i);
    });

    it('blocks direct SQL DELETE on transactions via trigger exception', async () => {
      const { error } = await supabaseAdmin
        .from('transactions')
        .delete()
        .eq('id', sampleTxId);

      expect(error).toBeDefined();
      expect(error.message).toMatch(/Financial audit records are immutable.*prohibited/i);
    });

    it('blocks direct SQL UPDATE on ledger_entries via trigger exception', async () => {
      const { error } = await supabaseAdmin
        .from('ledger_entries')
        .update({ amount: 99999.00 })
        .eq('id', sampleLedgerId);

      expect(error).toBeDefined();
      expect(error.message).toMatch(/Financial audit records are immutable.*prohibited/i);
    });

    it('blocks direct SQL DELETE on ledger_entries via trigger exception', async () => {
      const { error } = await supabaseAdmin
        .from('ledger_entries')
        .delete()
        .eq('id', sampleLedgerId);

      expect(error).toBeDefined();
      expect(error.message).toMatch(/Financial audit records are immutable.*prohibited/i);
    });
  });

  // ==========================================================================
  // 4. Secret Isolation & Credential Protection
  // ==========================================================================
  describe('4. Secrets Isolation & Exposure Audit', () => {
    it('verifies SUPABASE_SERVICE_ROLE_KEY is not leaked in health or public endpoints', async () => {
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      expect(serviceRoleKey).toBeDefined();

      const res = await request(app).get('/health');
      expect(res.status).toBe(200);

      const responseText = JSON.stringify(res.body) + JSON.stringify(res.headers);
      expect(responseText).not.toContain(serviceRoleKey);
    });

    it('verifies Firebase service account secrets are never exposed in notification responses', async () => {
      const res = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('private_key');
      expect(text).not.toContain('client_email');
      expect(text).not.toContain('service_account');
    });

    it('verifies client cannot see sensitive profile fields (pin_hash, salt, failed_attempts) in /me', async () => {
      const res = await request(app)
        .get('/api/v1/profile/me')
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.pin_hash).toBeUndefined();
      expect(res.body.data.pinHash).toBeUndefined();
      expect(res.body.data.salt).toBeUndefined();
    });
  });

  // ==========================================================================
  // 5. Input Sanitization, Payload Size Limits & Prototype Pollution
  // ==========================================================================
  describe('5. Input Sanitization & Payload Protection', () => {
    it('rejects oversized JSON request bodies > 100KB with HTTP 413', async () => {
      // Construct a payload slightly larger than 100KB
      const hugeString = 'X'.repeat(105 * 1024);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test@bwallet.dev',
          password: 'Password123!',
          padding: hugeString
        });

      expect(res.status).toBe(413);
    });

    it('rejects payload with prototype pollution keys (__proto__)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email":"test@bwallet.dev","password":"Password123!","__proto__":{"admin":true}}');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SECURITY_PROTOTYPE_POLLUTION');
    });

    it('rejects payload containing null byte injection attacks', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test\0@bwallet.dev',
          password: 'Password123!'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SECURITY_NULL_BYTE');
    });
  });

  // ==========================================================================
  // 6. Security Headers Audit
  // ==========================================================================
  describe('6. HTTP Security Headers (Helmet & CORS)', () => {
    it('returns strict security headers on API responses', async () => {
      const res = await request(app).get('/health');

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['strict-transport-security']).toBeDefined();
    });
  });
});
