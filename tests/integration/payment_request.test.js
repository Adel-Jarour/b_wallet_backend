/**
 * Integration Tests: Payment Requests & Invoicing Engine
 * =======================================================
 * Covers:
 *   - Full request lifecycle (create → pay / decline / cancel)
 *   - Authorization enforcement (only payer can pay/decline, only requester can cancel)
 *   - Double-entry ledger balance verification on settlement
 *   - Terminal state guards (COMPLETED/DECLINED/CANCELLED cannot be re-settled)
 *   - Idempotency on /pay endpoint
 *   - Self-request guard
 *   - Invalid PIN rejection
 *   - Transaction ticket authorization
 */

const request = require('supertest');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const app = require('../../src/app');
const { supabaseAdmin } = require('../../src/config/supabase');
const PinService = require('../../src/services/pin.service');

jest.setTimeout(120000);

describe('Integration: Payment Requests & Invoicing (/api/v1/requests)', () => {
  const testUsersToCleanup = [];
  const testRequestIdsToCleanup = [];
  const testTxIdsToCleanup = [];
  const testIdempotencyKeysToCleanup = [];

  // Three test users: requester (Alice), payer (Bob), third party (Eve)
  let requesterUser, requesterToken;
  let payerUser, payerToken;
  let thirdPartyUser, thirdPartyToken;

  let requesterWallet, payerWallet;

  const requesterEmail = `req_alice_${Date.now()}@bwallet.dev`;
  const payerEmail = `req_bob_${Date.now()}@bwallet.dev`;
  const thirdPartyEmail = `req_eve_${Date.now()}@bwallet.dev`;

  const payerPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
  const requesterPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;

  const password = 'Password123!';
  const validPin = '654321';
  const wrongPin = '000000';

  beforeAll(async () => {
    // 1. Register Requester (Alice)
    const resAlice = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: requesterEmail, password, firstName: 'Alice', lastName: 'Requester' });
    expect(resAlice.status).toBe(201);
    requesterUser = resAlice.body.data.user;
    testUsersToCleanup.push(requesterUser.id);

    await supabaseAdmin.from('profiles').update({ phone_number: requesterPhone }).eq('id', requesterUser.id);

    const loginAlice = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: requesterEmail, password });
    expect(loginAlice.status).toBe(200);
    requesterToken = loginAlice.body.data.accessToken;

    // 2. Register Payer (Bob)
    const resBob = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: payerEmail, password, firstName: 'Bob', lastName: 'Payer' });
    expect(resBob.status).toBe(201);
    payerUser = resBob.body.data.user;
    testUsersToCleanup.push(payerUser.id);

    await supabaseAdmin.from('profiles').update({ phone_number: payerPhone }).eq('id', payerUser.id);

    const loginBob = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: payerEmail, password });
    expect(loginBob.status).toBe(200);
    payerToken = loginBob.body.data.accessToken;

    // Set up PIN for Payer (needed for /pay endpoint)
    await PinService.setupPin(payerUser.id, validPin);

    // 3. Register Third Party (Eve)
    const resEve = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: thirdPartyEmail, password, firstName: 'Eve', lastName: 'ThirdParty' });
    expect(resEve.status).toBe(201);
    thirdPartyUser = resEve.body.data.user;
    testUsersToCleanup.push(thirdPartyUser.id);

    const loginEve = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: thirdPartyEmail, password });
    thirdPartyToken = loginEve.body.data.accessToken;

    // Fetch wallets
    const { data: wR } = await supabaseAdmin
      .from('wallets').select('*').eq('user_id', requesterUser.id).single();
    requesterWallet = wR;

    const { data: wP } = await supabaseAdmin
      .from('wallets').select('*').eq('user_id', payerUser.id).single();
    payerWallet = wP;
  });

  afterAll(async () => {
    // Cleanup ledger entries linked to test transactions
    if (testTxIdsToCleanup.length > 0) {
      await supabaseAdmin.from('ledger_entries').delete().in('transaction_id', testTxIdsToCleanup);
      await supabaseAdmin.from('transactions').delete().in('id', testTxIdsToCleanup);
    }
    // Cleanup idempotency keys
    if (testIdempotencyKeysToCleanup.length > 0) {
      await supabaseAdmin.from('idempotency_keys').delete().in('key', testIdempotencyKeysToCleanup);
    }
    // Cleanup payment requests
    if (testRequestIdsToCleanup.length > 0) {
      await supabaseAdmin.from('payment_requests').delete().in('id', testRequestIdsToCleanup);
    }
    // Cleanup used tickets
    if (testUsersToCleanup.length > 0) {
      await supabaseAdmin.from('used_transaction_tickets').delete().in('user_id', testUsersToCleanup);
    }
    // Delete test users
    for (const uid of testUsersToCleanup) {
      try { await supabaseAdmin.auth.admin.deleteUser(uid); } catch (_) {}
    }
  });

  // ============================================================================
  // POST /api/v1/requests — Create Request
  // ============================================================================
  describe('POST /api/v1/requests', () => {
    it('should reject unauthenticated request creation (401)', async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .send({ payerPhone, amount: 50.00, category: 'Food' });

      expect(res.status).toBe(401);
    });

    it('should reject self-request (requester = payer)', async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ payerPhone: requesterPhone, amount: 50.00, category: 'Food' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SELF_REQUEST_NOT_ALLOWED');
    });

    it('should reject invalid amount (negative)', async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ payerPhone, amount: -10.00, category: 'Food' });

      expect(res.status).toBe(400);
    });

    it('should reject missing payer identifier', async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ amount: 50.00, category: 'Food' });

      expect(res.status).toBe(400);
    });

    it('TC-REQ-01: should successfully create a PENDING payment request', async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          payerPhone,
          amount: 75.00,
          category: 'Food',
          note: 'Dinner split'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const req = res.body.data.request;
      expect(req.status).toBe('PENDING');
      expect(req.amount).toBe('75.00');
      expect(req.requesterId).toBe(requesterUser.id);
      expect(req.payerId).toBe(payerUser.id);
      expect(req.note).toBe('Dinner split');

      testRequestIdsToCleanup.push(req.id);
    });

    it('should create request by email lookup', async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ payerEmail, amount: 20.00, category: 'Hobby' });

      expect(res.status).toBe(201);
      expect(res.body.data.request.status).toBe('PENDING');
      testRequestIdsToCleanup.push(res.body.data.request.id);
    });
  });

  // ============================================================================
  // GET /api/v1/requests
  // ============================================================================
  describe('GET /api/v1/requests', () => {
    it('should reject unauthenticated listing (401)', async () => {
      const res = await request(app).get('/api/v1/requests');
      expect(res.status).toBe(401);
    });

    it('should return paginated list of requests for authenticated user', async () => {
      const res = await request(app)
        .get('/api/v1/requests')
        .set('Authorization', `Bearer ${requesterToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.requests)).toBe(true);
      expect(typeof res.body.data.total).toBe('number');
      expect(res.body.data.page).toBe(1);
    });

    it('should filter by direction=sent (only Alice\'s sent requests)', async () => {
      const res = await request(app)
        .get('/api/v1/requests?direction=sent')
        .set('Authorization', `Bearer ${requesterToken}`);

      expect(res.status).toBe(200);
      // All returned requests must have Alice as requester
      res.body.data.requests.forEach(r => {
        expect(r.requesterId).toBe(requesterUser.id);
      });
    });

    it('should filter by direction=received (Bob sees incoming requests)', async () => {
      const res = await request(app)
        .get('/api/v1/requests?direction=received')
        .set('Authorization', `Bearer ${payerToken}`);

      expect(res.status).toBe(200);
      res.body.data.requests.forEach(r => {
        expect(r.payerId).toBe(payerUser.id);
      });
    });

    it('should filter by status=PENDING', async () => {
      const res = await request(app)
        .get('/api/v1/requests?status=PENDING')
        .set('Authorization', `Bearer ${requesterToken}`);

      expect(res.status).toBe(200);
      res.body.data.requests.forEach(r => {
        expect(r.status).toBe('PENDING');
      });
    });

    it('should reject invalid pagination parameters', async () => {
      const res = await request(app)
        .get('/api/v1/requests?page=0')
        .set('Authorization', `Bearer ${requesterToken}`);

      expect(res.status).toBe(400);
    });
  });

  // ============================================================================
  // GET /api/v1/requests/:id
  // ============================================================================
  describe('GET /api/v1/requests/:id', () => {
    let testRequestId;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ payerPhone, amount: 30.00, category: 'Expense', note: 'Gas money' });

      expect(res.status).toBe(201);
      testRequestId = res.body.data.request.id;
      testRequestIdsToCleanup.push(testRequestId);
    });

    it('should allow requester to view the request', async () => {
      const res = await request(app)
        .get(`/api/v1/requests/${testRequestId}`)
        .set('Authorization', `Bearer ${requesterToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.request.id).toBe(testRequestId);
    });

    it('should allow payer to view the request', async () => {
      const res = await request(app)
        .get(`/api/v1/requests/${testRequestId}`)
        .set('Authorization', `Bearer ${payerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.request.id).toBe(testRequestId);
    });

    it('should forbid third party from viewing the request (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/requests/${testRequestId}`)
        .set('Authorization', `Bearer ${thirdPartyToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('REQUEST_ACCESS_DENIED');
    });

    it('should return 404 for non-existent request', async () => {
      const res = await request(app)
        .get(`/api/v1/requests/${uuidv4()}`)
        .set('Authorization', `Bearer ${requesterToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('REQUEST_NOT_FOUND');
    });
  });

  // ============================================================================
  // POST /api/v1/requests/:id/pay
  // ============================================================================
  describe('POST /api/v1/requests/:id/pay', () => {
    let payableRequestId;

    beforeAll(async () => {
      // Set balances: payer $200, requester $0
      await supabaseAdmin.from('wallets').update({ balance: '200.00' }).eq('id', payerWallet.id);
      await supabaseAdmin.from('wallets').update({ balance: '0.00' }).eq('id', requesterWallet.id);

      // Create a fresh PENDING request
      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ payerPhone, amount: 60.00, category: 'Food', note: 'Lunch' });

      expect(res.status).toBe(201);
      payableRequestId = res.body.data.request.id;
      testRequestIdsToCleanup.push(payableRequestId);
    });

    it('should reject /pay without X-Idempotency-Key', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${payableRequestId}/pay`)
        .set('Authorization', `Bearer ${payerToken}`)
        .send({ pin: validPin });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_MISSING');
    });

    it('should reject /pay from a third party (403)', async () => {
      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post(`/api/v1/requests/${payableRequestId}/pay`)
        .set('Authorization', `Bearer ${thirdPartyToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({ pin: validPin });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('REQUEST_PAY_FORBIDDEN');
    });

    it('should reject /pay with wrong PIN', async () => {
      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post(`/api/v1/requests/${payableRequestId}/pay`)
        .set('Authorization', `Bearer ${payerToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({ pin: wrongPin });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INCORRECT_PIN');
    });

    it('TC-REQ-02: Payer pays with valid PIN → payer debited, requester credited, request COMPLETED, ledger balanced', async () => {
      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post(`/api/v1/requests/${payableRequestId}/pay`)
        .set('Authorization', `Bearer ${payerToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({ pin: validPin });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const receipt = res.body.data.receipt;
      expect(receipt.status).toBe('COMPLETED');
      expect(receipt.amount).toBe('60.00');
      expect(receipt.payerBalanceAfter).toBe('140.00'); // 200 - 60
      expect(receipt.transactionReference).toMatch(/^REQ-\d{8}-[A-Z0-9]{8}$/);
      testTxIdsToCleanup.push(receipt.transactionId);

      // Verify payer wallet balance
      const { data: pW } = await supabaseAdmin.from('wallets').select('balance').eq('id', payerWallet.id).single();
      expect(parseFloat(pW.balance)).toBe(140.00);

      // Verify requester wallet balance
      const { data: rW } = await supabaseAdmin.from('wallets').select('balance').eq('id', requesterWallet.id).single();
      expect(parseFloat(rW.balance)).toBe(60.00);

      // Verify payment_requests.status = COMPLETED
      const { data: req } = await supabaseAdmin.from('payment_requests').select('status, transaction_id').eq('id', payableRequestId).single();
      expect(req.status).toBe('COMPLETED');
      expect(req.transaction_id).toBe(receipt.transactionId);

      // Verify double-entry ledger: 2 entries, balanced
      const { data: ledger } = await supabaseAdmin
        .from('ledger_entries')
        .select('*')
        .eq('transaction_id', receipt.transactionId);

      expect(ledger).toHaveLength(2);
      ledger.forEach(e => testTxIdsToCleanup.push(e.transaction_id));

      const debit = ledger.find(e => e.direction === 'DEBIT');
      const credit = ledger.find(e => e.direction === 'CREDIT');

      expect(debit.wallet_id).toBe(payerWallet.id);
      expect(parseFloat(debit.amount)).toBe(60.00);
      expect(credit.wallet_id).toBe(requesterWallet.id);
      expect(parseFloat(credit.amount)).toBe(60.00);

      // Ledger balanced: sum(DEBIT) === sum(CREDIT)
      expect(parseFloat(debit.amount)).toBe(parseFloat(credit.amount));
    });

    it('TC-REQ-03: Attempt to pay an already COMPLETED request → 400 REQUEST_NOT_PENDING', async () => {
      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post(`/api/v1/requests/${payableRequestId}/pay`)
        .set('Authorization', `Bearer ${payerToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({ pin: validPin });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('REQUEST_NOT_PENDING');
    });

    it('TC-IDEM-01: Identical /pay request with same X-Idempotency-Key replays cached response (no double debit)', async () => {
      // Fresh request and balances
      await supabaseAdmin.from('wallets').update({ balance: '100.00' }).eq('id', payerWallet.id);
      await supabaseAdmin.from('wallets').update({ balance: '0.00' }).eq('id', requesterWallet.id);

      const freshRes = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ payerPhone, amount: 25.00, category: 'Hobby', note: 'Idempotency test' });
      expect(freshRes.status).toBe(201);
      const freshRequestId = freshRes.body.data.request.id;
      testRequestIdsToCleanup.push(freshRequestId);

      const fixedIdemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(fixedIdemKey);

      // First /pay
      const res1 = await request(app)
        .post(`/api/v1/requests/${freshRequestId}/pay`)
        .set('Authorization', `Bearer ${payerToken}`)
        .set('X-Idempotency-Key', fixedIdemKey)
        .send({ pin: validPin });

      expect(res1.status).toBe(200);
      const receipt1 = res1.body.data.receipt;
      testTxIdsToCleanup.push(receipt1.transactionId);

      // Second identical /pay with same key → cached replay
      const res2 = await request(app)
        .post(`/api/v1/requests/${freshRequestId}/pay`)
        .set('Authorization', `Bearer ${payerToken}`)
        .set('X-Idempotency-Key', fixedIdemKey)
        .send({ pin: validPin });

      expect(res2.status).toBe(200);
      const receipt2 = res2.body.data.receipt;

      // Same receipt returned
      expect(receipt2.transactionId).toBe(receipt1.transactionId);
      expect(receipt2.transactionReference).toBe(receipt1.transactionReference);

      // Payer debited exactly once
      const { data: pW } = await supabaseAdmin.from('wallets').select('balance').eq('id', payerWallet.id).single();
      expect(parseFloat(pW.balance)).toBe(75.00); // 100 - 25 = 75

      // Requester credited exactly once
      const { data: rW } = await supabaseAdmin.from('wallets').select('balance').eq('id', requesterWallet.id).single();
      expect(parseFloat(rW.balance)).toBe(25.00); // 0 + 25 = 25
    });

    it('should reject /pay when payer has insufficient funds', async () => {
      await supabaseAdmin.from('wallets').update({ balance: '5.00' }).eq('id', payerWallet.id);

      const req = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ payerPhone, amount: 50.00, category: 'Food' });
      expect(req.status).toBe(201);
      const newRequestId = req.body.data.request.id;
      testRequestIdsToCleanup.push(newRequestId);

      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post(`/api/v1/requests/${newRequestId}/pay`)
        .set('Authorization', `Bearer ${payerToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({ pin: validPin });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    });
  });

  // ============================================================================
  // POST /api/v1/requests/:id/decline
  // ============================================================================
  describe('POST /api/v1/requests/:id/decline', () => {
    let declinableRequestId;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ payerPhone, amount: 15.00, category: 'Entertainment', note: 'Movie' });
      expect(res.status).toBe(201);
      declinableRequestId = res.body.data.request.id;
      testRequestIdsToCleanup.push(declinableRequestId);
    });

    it('should forbid third party from declining (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${declinableRequestId}/decline`)
        .set('Authorization', `Bearer ${thirdPartyToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('REQUEST_DECLINE_FORBIDDEN');
    });

    it('should forbid requester from declining their own request (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${declinableRequestId}/decline`)
        .set('Authorization', `Bearer ${requesterToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('REQUEST_DECLINE_FORBIDDEN');
    });

    it('TC-REQ-04: Payer declines request → status becomes DECLINED', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${declinableRequestId}/decline`)
        .set('Authorization', `Bearer ${payerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.request.status).toBe('DECLINED');

      // Verify in DB
      const { data: req } = await supabaseAdmin.from('payment_requests').select('status').eq('id', declinableRequestId).single();
      expect(req.status).toBe('DECLINED');
    });

    it('should reject declining a DECLINED request (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${declinableRequestId}/decline`)
        .set('Authorization', `Bearer ${payerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('REQUEST_NOT_PENDING');
    });
  });

  // ============================================================================
  // POST /api/v1/requests/:id/cancel
  // ============================================================================
  describe('POST /api/v1/requests/:id/cancel', () => {
    let cancellableRequestId;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ payerPhone, amount: 10.00, category: 'Food', note: 'Coffee' });
      expect(res.status).toBe(201);
      cancellableRequestId = res.body.data.request.id;
      testRequestIdsToCleanup.push(cancellableRequestId);
    });

    it('should forbid third party from cancelling (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${cancellableRequestId}/cancel`)
        .set('Authorization', `Bearer ${thirdPartyToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('REQUEST_CANCEL_FORBIDDEN');
    });

    it('should forbid payer from cancelling (only requester can cancel) (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${cancellableRequestId}/cancel`)
        .set('Authorization', `Bearer ${payerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('REQUEST_CANCEL_FORBIDDEN');
    });

    it('TC-REQ-05: Requester cancels their own request → status becomes CANCELLED', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${cancellableRequestId}/cancel`)
        .set('Authorization', `Bearer ${requesterToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.request.status).toBe('CANCELLED');

      // Verify in DB
      const { data: req } = await supabaseAdmin.from('payment_requests').select('status').eq('id', cancellableRequestId).single();
      expect(req.status).toBe('CANCELLED');
    });

    it('should reject cancelling a CANCELLED request (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${cancellableRequestId}/cancel`)
        .set('Authorization', `Bearer ${requesterToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('REQUEST_NOT_PENDING');
    });
  });

  // ============================================================================
  // Terminal State Guards: COMPLETED cannot be paid/declined/cancelled
  // ============================================================================
  describe('Terminal State Guards', () => {
    let completedRequestId;

    beforeAll(async () => {
      await supabaseAdmin.from('wallets').update({ balance: '200.00' }).eq('id', payerWallet.id);
      await supabaseAdmin.from('wallets').update({ balance: '0.00' }).eq('id', requesterWallet.id);

      const createRes = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ payerPhone, amount: 10.00, category: 'Food', note: 'Terminal state test' });
      expect(createRes.status).toBe(201);
      completedRequestId = createRes.body.data.request.id;
      testRequestIdsToCleanup.push(completedRequestId);

      // Pay it to make it COMPLETED
      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);
      const payRes = await request(app)
        .post(`/api/v1/requests/${completedRequestId}/pay`)
        .set('Authorization', `Bearer ${payerToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({ pin: validPin });
      expect(payRes.status).toBe(200);
      testTxIdsToCleanup.push(payRes.body.data.receipt.transactionId);
    });

    it('COMPLETED request cannot be paid again (400)', async () => {
      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);
      const res = await request(app)
        .post(`/api/v1/requests/${completedRequestId}/pay`)
        .set('Authorization', `Bearer ${payerToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({ pin: validPin });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('REQUEST_NOT_PENDING');
    });

    it('COMPLETED request cannot be declined (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${completedRequestId}/decline`)
        .set('Authorization', `Bearer ${payerToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('REQUEST_NOT_PENDING');
    });

    it('COMPLETED request cannot be cancelled (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/requests/${completedRequestId}/cancel`)
        .set('Authorization', `Bearer ${requesterToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('REQUEST_NOT_PENDING');
    });
  });
});
