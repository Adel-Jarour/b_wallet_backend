/**
 * End-to-End (E2E) Test Suite: Full Application Lifecycle
 * =======================================================
 * Validates the complete multi-user B-Wallet fintech lifecycle:
 *   1. System Health & OpenAPI 3.0 Documentation Endpoints
 *   2. User Registration, Auto-Provisioning & Session Management (Alice & Bob)
 *   3. Profile Management & Anti-Data-Leakage Verification (pin_hash never exposed)
 *   4. Argon2id PIN Security Engine (Setup, Lockout Guard, Ticket Authorization)
 *   5. Top-Up Engine via Cryptographic HMAC Webhook Settlement & Double-Entry Ledger
 *   6. P2P Fund Transfer with Symmetrical Double-Entry Ledger & Idempotency Guarantee
 *   7. Payment Requests Lifecycle (Create -> Settle with PIN -> Ledger Balance)
 *   8. Notification Ingestion, List & Read Status Lifecycle
 *   9. Real-Time Messaging with Embedded Transaction Receipt Reference
 *  10. Cash Flow Analytics Mathematical Aggregation & Expense Breakdown
 *  11. Deterministic Multi-User Teardown & Resource Cleanup
 */

const request = require('supertest');
const crypto = require('crypto');
const app = require('../../src/app');
const { supabaseAdmin } = require('../../src/config/supabase');
const { MockPaymentGatewayAdapter } = require('../../src/services/gateways');
const { env } = require('../../src/config/env');

const uuidv4 = () => crypto.randomUUID();

jest.setTimeout(180000);

describe('E2E: Full Multi-User FinTech Application Lifecycle', () => {
  // Tracking arrays for clean teardown
  const testUsersToCleanup = [];
  const testTxIdsToCleanup = [];
  const testLedgerIdsToCleanup = [];
  const testRequestIdsToCleanup = [];
  const testConvoIdsToCleanup = [];
  const testIdempotencyKeysToCleanup = [];

  // Users
  let aliceUser, aliceToken, aliceRefreshToken, aliceWallet;
  let bobUser, bobToken, bobRefreshToken, bobWallet;

  const timestamp = Date.now();
  const aliceEmail = `e2e_alice_${timestamp}@bwallet.dev`;
  const bobEmail = `e2e_bob_${timestamp}@bwallet.dev`;
  const testPassword = 'SecurePassword2026!';
  const alicePin = '123456';
  const bobPin = '654321';

  const alicePhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
  const bobPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;

  const webhookSecret = env.PAYMENT_GATEWAY_WEBHOOK_SECRET || 'test_webhook_secret_key_bwallet_2026';
  const mockAdapter = new MockPaymentGatewayAdapter(webhookSecret);

  let p2pTransactionId;
  let paymentRequestId;
  let activeConversationId;

  afterAll(async () => {
    // 1. Cleanup messages & conversations
    if (testConvoIdsToCleanup.length > 0) {
      await supabaseAdmin.from('messages').delete().in('conversation_id', testConvoIdsToCleanup);
      await supabaseAdmin.from('conversations').delete().in('id', testConvoIdsToCleanup);
    }

    // 2. Cleanup payment requests
    if (testRequestIdsToCleanup.length > 0) {
      await supabaseAdmin.from('payment_requests').delete().in('id', testRequestIdsToCleanup);
    }

    // 3. Cleanup notifications
    if (testUsersToCleanup.length > 0) {
      await supabaseAdmin.from('notifications').delete().in('user_id', testUsersToCleanup);
    }

    // 4. Cleanup used transaction tickets
    if (testUsersToCleanup.length > 0) {
      await supabaseAdmin.from('used_transaction_tickets').delete().in('user_id', testUsersToCleanup);
    }

    // 5. Cleanup idempotency keys
    if (testIdempotencyKeysToCleanup.length > 0) {
      await supabaseAdmin.from('idempotency_keys').delete().in('key', testIdempotencyKeysToCleanup);
    }

    // 6. Cleanup ledger entries
    if (testTxIdsToCleanup.length > 0) {
      await supabaseAdmin.from('ledger_entries').delete().in('transaction_id', testTxIdsToCleanup);
    }
    if (testLedgerIdsToCleanup.length > 0) {
      await supabaseAdmin.from('ledger_entries').delete().in('id', testLedgerIdsToCleanup);
    }

    // 7. Cleanup transactions
    if (testTxIdsToCleanup.length > 0) {
      await supabaseAdmin.from('transactions').delete().in('id', testTxIdsToCleanup);
    }

    // 8. Cleanup wallets, profiles, and auth users
    for (const uid of testUsersToCleanup) {
      try {
        await supabaseAdmin.from('wallets').delete().eq('user_id', uid);
        await supabaseAdmin.from('profiles').delete().eq('id', uid);
        await supabaseAdmin.auth.admin.deleteUser(uid);
      } catch (err) {
        // Continue cleanup
      }
    }
  });

  // ============================================================================
  // STAGE 1: SYSTEM HEALTH & OPENAPI SPECIFICATION
  // ============================================================================
  describe('Stage 1: System Health & OpenAPI Documentation', () => {
    test('1.1 GET /health returns 200 and system health indicators', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(['ok', 'UP']).toContain(res.body.status);
      expect(res.body.timestamp).toBeDefined();
    });

    test('1.2 GET /api-docs.json returns valid OpenAPI 3.0 specification', async () => {
      const res = await request(app).get('/api-docs.json');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.body.openapi).toBe('3.0.3');
      expect(res.body.info.title).toContain('B-Wallet');
      expect(Object.keys(res.body.paths).length).toBeGreaterThanOrEqual(25);
    });

    test('1.3 GET /api-docs serves interactive HTML documentation page', async () => {
      const res = await request(app).get('/api-docs');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(res.text).toContain('B-Wallet API Documentation');
    });
  });

  // ============================================================================
  // STAGE 2: MULTI-USER REGISTRATION & AUTHENTICATION
  // ============================================================================
  describe('Stage 2: Multi-User Registration & Authentication Lifecycle', () => {
    test('2.1 Register Alice with profile and auto-provisioned wallet', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: aliceEmail,
          password: testPassword,
          firstName: 'Alice',
          lastName: 'Tester',
          phoneNumber: alicePhone
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.email).toBe(aliceEmail);
      expect(res.body.data.profile.first_name).toBe('Alice');

      // Security assertion: pin_hash is never exposed
      expect(res.body.data.profile.pin_hash).toBeUndefined();

      aliceUser = res.body.data.user;
      testUsersToCleanup.push(aliceUser.id);

      // Verify wallet provisioned
      const { data: w } = await supabaseAdmin
        .from('wallets')
        .select('*')
        .eq('user_id', aliceUser.id)
        .single();
      expect(w).toBeDefined();
      expect(parseFloat(w.balance)).toBe(0.00);
      aliceWallet = w;
    });

    test('2.2 Register Bob with profile and auto-provisioned wallet', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: bobEmail,
          password: testPassword,
          firstName: 'Bob',
          lastName: 'Receiver',
          phoneNumber: bobPhone
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      bobUser = res.body.data.user;
      testUsersToCleanup.push(bobUser.id);

      const { data: w } = await supabaseAdmin
        .from('wallets')
        .select('*')
        .eq('user_id', bobUser.id)
        .single();
      expect(w).toBeDefined();
      bobWallet = w;
    });

    test('2.3 Login Alice and obtain JWT session tokens', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: aliceEmail, password: testPassword });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();

      aliceToken = res.body.data.accessToken;
      aliceRefreshToken = res.body.data.refreshToken;
    });

    test('2.4 Login Bob and obtain JWT session tokens', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: bobEmail, password: testPassword });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();

      bobToken = res.body.data.accessToken;
      bobRefreshToken = res.body.data.refreshToken;
    });

    test('2.5 Refresh Alice session token via POST /api/v1/auth/refresh', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: aliceRefreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      aliceToken = res.body.data.accessToken;
    });
  });

  // ============================================================================
  // STAGE 3: USER PROFILES & DATA PROTECTION AUDIT
  // ============================================================================
  describe('Stage 3: Profile Management & Data Protection', () => {
    test('3.1 GET /api/v1/profile/me returns user details without pin_hash leak', async () => {
      const res = await request(app)
        .get('/api/v1/profile/me')
        .set('Authorization', `Bearer ${aliceToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(aliceUser.id);
      expect(res.body.data.first_name).toBe('Alice');
      expect(res.body.data.pin_hash).toBeUndefined();
    });

    test('3.2 PATCH /api/v1/profile/me successfully updates avatar/bio', async () => {
      const res = await request(app)
        .patch('/api/v1/profile/me')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          avatarUrl: 'https://cdn.bwallet.dev/avatars/alice.png'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.avatar_url).toBe('https://cdn.bwallet.dev/avatars/alice.png');
    });
  });

  // ============================================================================
  // STAGE 4: PIN SECURITY ENGINE & TICKET ISSUANCE
  // ============================================================================
  describe('Stage 4: Argon2id PIN Security Engine', () => {
    test('4.1 Alice checks PIN status -> hasPin: false', async () => {
      const res = await request(app)
        .get('/api/v1/auth/pin/status')
        .set('Authorization', `Bearer ${aliceToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hasPin).toBe(false);
      expect(res.body.data.pin_hash).toBeUndefined();
    });

    test('4.2 Alice sets up 6-digit PIN with Argon2id', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/setup')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ pin: alicePin, confirmPin: alicePin });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      // Verify Argon2id in DB
      const { data: p } = await supabaseAdmin
        .from('profiles')
        .select('pin_hash')
        .eq('id', aliceUser.id)
        .single();
      expect(p.pin_hash).toMatch(/^\$argon2id\$/);
    });

    test('4.3 Bob sets up 6-digit PIN with Argon2id', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/setup')
        .set('Authorization', `Bearer ${bobToken}`)
        .send({ pin: bobPin, confirmPin: bobPin });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    test('4.4 Alice verifies PIN and receives short-lived transaction ticket', async () => {
      const res = await request(app)
        .post('/api/v1/auth/pin/verify')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ pin: alicePin });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.authorized).toBe(true);
      expect(res.body.data.ticket).toBeDefined();
      expect(res.body.data.expiresInSeconds).toBe(300);
    });
  });

  // ============================================================================
  // STAGE 5: TOP-UP VIA HMAC WEBHOOK & DOUBLE-ENTRY LEDGER
  // ============================================================================
  describe('Stage 5: Top-Up Webhook Settlement & Double-Entry Ledger', () => {
    const topUpAmount = 250.00;
    const paymentIntentId = `pi_e2e_topup_${Date.now()}`;

    test('5.1 Verified webhook atomically credits Alice wallet $250.00 and logs balanced ledger entries', async () => {
      const payload = {
        event: 'payment_intent.succeeded',
        data: {
          id: paymentIntentId,
          amount: topUpAmount,
          currency: 'USD',
          metadata: {
            user_id: aliceUser.id,
            wallet_id: aliceWallet.id
          }
        }
      };

      const rawString = JSON.stringify(payload);
      const { header } = mockAdapter.generateWebhookSignature({
        payload: rawString,
        secret: webhookSecret
      });

      const res = await request(app)
        .post('/api/v1/webhooks/payments')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Signature', header)
        .send(rawString);

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(res.body.status).toBe('success');
      expect(res.body.receipt).toBeDefined();
      expect(parseFloat(res.body.receipt.amount)).toBe(topUpAmount);

      const txId = res.body.receipt.transaction_id;
      testTxIdsToCleanup.push(txId);

      // Verify wallet balance in DB
      const { data: updatedW } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', aliceWallet.id)
        .single();
      expect(parseFloat(updatedW.balance)).toBe(250.00);

      // Verify double-entry ledger entries
      const { data: ledgerEntries } = await supabaseAdmin
        .from('ledger_entries')
        .select('*')
        .eq('transaction_id', txId);

      expect(ledgerEntries).toHaveLength(2);
      const totalDebits = ledgerEntries.reduce((sum, e) => sum + parseFloat(e.debit || 0), 0);
      const totalCredits = ledgerEntries.reduce((sum, e) => sum + parseFloat(e.credit || 0), 0);
      expect(totalDebits).toBeCloseTo(totalCredits, 2);
    });

    test('5.2 GET /api/v1/wallets/me reflects Alice updated balance ($250.00)', async () => {
      const res = await request(app)
        .get('/api/v1/wallets/me')
        .set('Authorization', `Bearer ${aliceToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(parseFloat(res.body.data.wallet.balance)).toBe(250.00);
    });
  });

  // ============================================================================
  // STAGE 6: P2P FUND TRANSFER & IDEMPOTENCY
  // ============================================================================
  describe('Stage 6: P2P Fund Transfer with Symmetrical Ledger & Idempotency', () => {
    const transferAmount = 50.00;
    const idempotencyKey = uuidv4();

    test('6.1 Alice transfers $50.00 to Bob with PIN authorization -> debits Alice, credits Bob', async () => {
      testIdempotencyKeysToCleanup.push(idempotencyKey);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Idempotency-Key', idempotencyKey)
        .send({
          receiver_phone: bobPhone,
          amount: transferAmount,
          category: 'Food',
          note: 'E2E test transfer for dinner',
          pin: alicePin
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const receipt = res.body.data.receipt;
      expect(receipt).toBeDefined();
      expect(parseFloat(receipt.amount)).toBe(50.00);
      expect(receipt.status).toBe('COMPLETED');
      expect(parseFloat(receipt.senderBalanceAfter)).toBe(200.00);

      p2pTransactionId = receipt.transactionId;
      testTxIdsToCleanup.push(p2pTransactionId);

      // Verify Bob received the funds in DB
      const { data: bW } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', bobWallet.id)
        .single();
      expect(parseFloat(bW.balance)).toBe(50.00);

      // Verify ledger entries are balanced
      const { data: entries } = await supabaseAdmin
        .from('ledger_entries')
        .select('*')
        .eq('transaction_id', p2pTransactionId);

      expect(entries).toHaveLength(2);
      const debits = entries.reduce((acc, e) => acc + parseFloat(e.debit || 0), 0);
      const credits = entries.reduce((acc, e) => acc + parseFloat(e.credit || 0), 0);
      expect(debits).toBeCloseTo(credits, 2);
    });

    test('6.2 Idempotency Replay: Re-submitting transfer with identical X-Idempotency-Key returns cached response without double debit', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Idempotency-Key', idempotencyKey)
        .send({
          receiver_phone: bobPhone,
          amount: transferAmount,
          category: 'Food',
          note: 'E2E test transfer for dinner',
          pin: alicePin
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.receipt.transactionId).toBe(p2pTransactionId);

      // Verify Alice balance is still $200.00 (NOT $150.00)
      const { data: aW } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', aliceWallet.id)
        .single();
      expect(parseFloat(aW.balance)).toBe(200.00);
    });
  });

  // ============================================================================
  // STAGE 7: PAYMENT REQUESTS & INVOICING ENGINE
  // ============================================================================
  describe('Stage 7: Payment Requests & Invoicing Settlement', () => {
    test('7.1 Bob requests $25.00 from Alice (POST /api/v1/requests)', async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${bobToken}`)
        .send({
          payerPhone: alicePhone,
          amount: 25.00,
          category: 'Food',
          note: 'Coffee reimbursement'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.request.status).toBe('PENDING');
      expect(parseFloat(res.body.data.request.amount)).toBe(25.00);

      paymentRequestId = res.body.data.request.id;
      testRequestIdsToCleanup.push(paymentRequestId);
    });

    test('7.2 Alice views incoming payment requests', async () => {
      const res = await request(app)
        .get('/api/v1/requests?direction=received')
        .set('Authorization', `Bearer ${aliceToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.requests).toBeInstanceOf(Array);
      const found = res.body.data.requests.find(r => r.id === paymentRequestId);
      expect(found).toBeDefined();
      expect(found.status).toBe('PENDING');
    });

    test('7.3 Alice settles payment request (POST /api/v1/requests/:id/pay) with PIN', async () => {
      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post(`/api/v1/requests/${paymentRequestId}/pay`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({ pin: alicePin });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const receipt = res.body.data.receipt;
      expect(receipt.status).toBe('COMPLETED');
      expect(parseFloat(receipt.amount)).toBe(25.00);
      expect(parseFloat(receipt.payerBalanceAfter)).toBe(175.00); // 200 - 25

      testTxIdsToCleanup.push(receipt.transactionId);

      // Verify Bob received payment -> 50 + 25 = 75.00
      const { data: bW } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', bobWallet.id)
        .single();
      expect(parseFloat(bW.balance)).toBe(75.00);

      // Verify payment request status updated in DB
      const { data: req } = await supabaseAdmin
        .from('payment_requests')
        .select('status')
        .eq('id', paymentRequestId)
        .single();
      expect(req.status).toBe('COMPLETED');
    });
  });

  // ============================================================================
  // STAGE 8: IN-APP NOTIFICATIONS ENGINE
  // ============================================================================
  describe('Stage 8: Notification Ingestion & Read Lifecycle', () => {
    let notificationId;

    test('8.1 Bob fetches notifications and receives transaction alerts', async () => {
      const res = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${bobToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.notifications).toBeInstanceOf(Array);
      expect(res.body.data.notifications.length).toBeGreaterThanOrEqual(1);

      const firstNotif = res.body.data.notifications[0];
      notificationId = firstNotif.id;
      expect(firstNotif.id).toBeDefined();
      expect(firstNotif.category).toBeDefined();
    });

    test('8.2 Bob marks notification as read (PATCH /api/v1/notifications/:id/read)', async () => {
      const res = await request(app)
        .patch(`/api/v1/notifications/${notificationId}/read`)
        .set('Authorization', `Bearer ${bobToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.is_read).toBe(true);
    });
  });

  // ============================================================================
  // STAGE 9: REAL-TIME MESSAGING & TRANSACTION RECEIPT CARDS
  // ============================================================================
  describe('Stage 9: Real-Time Messaging & Counterparty Chat', () => {
    test('9.1 Alice initiates conversation with Bob', async () => {
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ participantId: bobUser.id });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.counterparty.id).toBe(bobUser.id);

      activeConversationId = res.body.data.id;
      testConvoIdsToCleanup.push(activeConversationId);
    });

    test('9.2 Alice sends standard text message to Bob', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${activeConversationId}/messages`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ content: 'Hey Bob, all payments settled!' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe('Hey Bob, all payments settled!');
      expect(res.body.data.isOutgoing).toBe(true);
    });

    test('9.3 Bob sends reply referencing the settled P2P transaction receipt', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${activeConversationId}/messages`)
        .set('Authorization', `Bearer ${bobToken}`)
        .send({
          content: 'Confirmed, here is the receipt reference on my side.',
          transactionId: p2pTransactionId
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.transaction).toBeDefined();
      expect(res.body.data.transaction.id).toBe(p2pTransactionId);
    });

    test('9.4 Bob fetches conversation message history', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${activeConversationId}/messages`)
        .set('Authorization', `Bearer ${bobToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messages).toBeInstanceOf(Array);
      expect(res.body.data.messages.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================================
  // STAGE 10: CASH FLOW ANALYTICS
  // ============================================================================
  describe('Stage 10: Cash Flow Analytics Aggregation', () => {
    test('10.1 Alice requests monthly cash-flow analytics and receives verified mathematical summaries', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/cash-flow?period=monthly&currency=USD')
        .set('Authorization', `Bearer ${aliceToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { summary, categories, chart_data } = res.body.data;

      // Alice had $250.00 top-up inflow
      expect(summary.total_income).toBeGreaterThanOrEqual(250.00);

      // Alice had $50.00 (Transfer) + $25.00 (Paid Request) = $75.00 outflow
      expect(summary.total_expense).toBeGreaterThanOrEqual(75.00);

      // Net savings = total_income - total_expense
      expect(summary.net_savings).toBeCloseTo(summary.total_income - summary.total_expense, 2);

      // Categories array populated
      expect(categories).toBeInstanceOf(Array);
      const foodCategory = categories.find(c => c.category === 'Food');
      expect(foodCategory).toBeDefined();
      expect(foodCategory.total_amount).toBeGreaterThanOrEqual(75.00);

      // Chart data populated
      expect(chart_data).toBeInstanceOf(Array);
    });
  });
});
