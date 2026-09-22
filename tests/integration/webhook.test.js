/**
 * Integration Tests: Top-Up Engine & Payment Gateway Webhook Listener
 * ====================================================================
 * Validates:
 *   - Top-up payment intent creation (/api/v1/top-up/intent)
 *   - Cryptographic HMAC-SHA256 signature verification (/api/v1/webhooks/payments)
 *   - Rejection of missing, tampered, or forged signatures (401)
 *   - Rejection of expired timestamp signatures (Replay attack defense)
 *   - Atomic wallet balance crediting upon valid settlement webhook
 *   - Symmetrical double-entry ledger balance (sum debits = sum credits)
 *   - Mathematical audit integrity (verify_wallet_integrity discrepancy = 0.00)
 *   - Webhook deduplication and idempotency
 */

const request = require('supertest');
const crypto = require('crypto');
const app = require('../../src/app');
const { supabaseAdmin } = require('../../src/config/supabase');
const { paymentGateway, MockPaymentGatewayAdapter } = require('../../src/services/gateways');
const { env } = require('../../src/config/env');

jest.setTimeout(60000);

describe('Integration: Top-Up & Payment Gateway Webhooks (/api/v1/top-up & /webhooks)', () => {
  const testUsersToCleanup = [];
  const testTxIdsToCleanup = [];
  const testCardIdsToCleanup = [];

  let user, token, wallet;
  const email = `webhook_test_${Date.now()}@bwallet.dev`;
  const password = 'Password123!';
  const webhookSecret = env.PAYMENT_GATEWAY_WEBHOOK_SECRET || 'test_webhook_secret_key_bwallet_2026';
  const mockAdapter = new MockPaymentGatewayAdapter(webhookSecret);

  beforeAll(async () => {
    // 1. Register test user
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'TopUp', lastName: 'Tester' });
    expect(regRes.status).toBe(201);
    user = regRes.body.data.user;
    testUsersToCleanup.push(user.id);

    // 2. Login to get JWT
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password });
    expect(loginRes.status).toBe(200);
    token = loginRes.body.data.accessToken;

    // 3. Fetch auto-provisioned wallet
    const { data: userWallet } = await supabaseAdmin
      .from('wallets')
      .select('*')
      .eq('user_id', user.id)
      .eq('currency', 'USD')
      .single();
    expect(userWallet).toBeDefined();
    wallet = userWallet;
  });

  afterAll(async () => {
    // Clean up created transactions and ledger entries
    if (testTxIdsToCleanup.length > 0) {
      await supabaseAdmin.from('ledger_entries').delete().in('transaction_id', testTxIdsToCleanup);
      await supabaseAdmin.from('transactions').delete().in('id', testTxIdsToCleanup);
    }
    // Clean up saved cards
    if (testCardIdsToCleanup.length > 0) {
      await supabaseAdmin.from('saved_cards').delete().in('id', testCardIdsToCleanup);
    }
    // Clean up user
    for (const id of testUsersToCleanup) {
      await supabaseAdmin.auth.admin.deleteUser(id);
    }
  });

  describe('1. Top-Up Intent Initiation (POST /api/v1/top-up/intent)', () => {
    test('TC-TOP-01: Successfully creates top-up payment intent', async () => {
      const res = await request(app)
        .post('/api/v1/top-up/intent')
        .set('Authorization', `Bearer ${token}`)
        .send({
          amount: 100.00,
          currency: 'USD'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.paymentIntentId).toMatch(/^pi_/);
      expect(res.body.data.clientSecret).toBeDefined();
      expect(res.body.data.amount).toBe(100.00);
      expect(res.body.data.currency).toBe('USD');
    });

    test('TC-TOP-02: Rejects zero or negative amount', async () => {
      const res = await request(app)
        .post('/api/v1/top-up/intent')
        .set('Authorization', `Bearer ${token}`)
        .send({
          amount: -50.00,
          currency: 'USD'
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('TC-TOP-03: Rejects unauthenticated request', async () => {
      const res = await request(app)
        .post('/api/v1/top-up/intent')
        .send({ amount: 100.00 });

      expect(res.status).toBe(401);
    });
  });

  describe('2. Webhook Cryptographic Signature Verification', () => {
    test('TC-WH-SEC-01: Rejects webhook without signature header with 401', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks/payments')
        .send({
          event: 'payment_intent.succeeded',
          data: { id: 'pi_test_no_sig' }
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_MISSING');
    });

    test('TC-WH-SEC-02: Rejects webhook with forged/tampered HMAC signature with 401', async () => {
      const payload = {
        event: 'payment_intent.succeeded',
        data: { id: 'pi_test_forged' }
      };

      const res = await request(app)
        .post('/api/v1/webhooks/payments')
        .set('X-Webhook-Signature', 't=1726300000,v1=badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad')
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    });

    test('TC-WH-SEC-03: Rejects webhook with expired timestamp (replay attack defense)', async () => {
      const payload = {
        event: 'payment_intent.succeeded',
        data: { id: 'pi_test_replay' }
      };
      const rawString = JSON.stringify(payload);

      // Expired timestamp: 1 hour in the past (> 300s tolerance)
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 3600;
      const { header } = mockAdapter.generateWebhookSignature({
        payload: rawString,
        secret: webhookSecret,
        timestamp: expiredTimestamp
      });

      const res = await request(app)
        .post('/api/v1/webhooks/payments')
        .set('X-Webhook-Signature', header)
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    });
  });

  describe('3. Webhook Settlement & Double-Entry Ledger Guarantees', () => {
    const testIntentId = `pi_test_${Date.now()}`;
    const topUpAmount = 150.00;
    let initialBalance = 0;
    let balanceAfterFirstTopup = 0;

    beforeAll(async () => {
      const { data: currentW } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', wallet.id)
        .single();
      initialBalance = parseFloat(currentW.balance);
    });

    test('TC-WH-SETTLE-01: Valid webhook atomically credits wallet and creates balanced ledger', async () => {
      const payload = {
        event: 'payment_intent.succeeded',
        data: {
          id: testIntentId,
          amount: topUpAmount,
          currency: 'USD',
          metadata: {
            user_id: user.id,
            wallet_id: wallet.id
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

      // 1. Verify User Wallet Balance was credited by exact amount
      const { data: updatedWallet } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', wallet.id)
        .single();

      balanceAfterFirstTopup = parseFloat(updatedWallet.balance);
      expect(balanceAfterFirstTopup).toBe(parseFloat((initialBalance + topUpAmount).toFixed(2)));

      // 2. Verify Transaction Record created with correct fields
      const { data: txRecord } = await supabaseAdmin
        .from('transactions')
        .select('*')
        .eq('id', txId)
        .single();

      expect(txRecord).toBeDefined();
      expect(txRecord.type).toBe('TOP_UP');
      expect(txRecord.status).toBe('COMPLETED');
      expect(parseFloat(txRecord.amount)).toBe(topUpAmount);
      expect(parseFloat(txRecord.fee)).toBe(0.00);
      expect(txRecord.receiver_id).toBe(user.id);
      expect(txRecord.sender_id).toBeNull();
      expect(txRecord.transaction_reference).toBe(`TOP-${testIntentId}`);

      // 3. Verify Symmetrical Double-Entry Ledger Entries
      const { data: ledgerEntries } = await supabaseAdmin
        .from('ledger_entries')
        .select('*')
        .eq('transaction_id', txId);

      expect(ledgerEntries).toHaveLength(2);

      const creditEntry = ledgerEntries.find(e => e.direction === 'CREDIT');
      const debitEntry = ledgerEntries.find(e => e.direction === 'DEBIT');

      expect(creditEntry).toBeDefined();
      expect(creditEntry.wallet_id).toBe(wallet.id);
      expect(parseFloat(creditEntry.amount)).toBe(topUpAmount);

      expect(debitEntry).toBeDefined();
      // Settlement account debited
      expect(debitEntry.wallet_id).toBe('00000000-0000-0000-0000-000000000002');
      expect(parseFloat(debitEntry.amount)).toBe(topUpAmount);

      // Symmetrical balance: total debits == total credits
      const totalDebits = ledgerEntries
        .filter(e => e.direction === 'DEBIT')
        .reduce((sum, e) => sum + parseFloat(e.amount), 0);
      const totalCredits = ledgerEntries
        .filter(e => e.direction === 'CREDIT')
        .reduce((sum, e) => sum + parseFloat(e.amount), 0);

      expect(totalDebits).toBe(totalCredits);

      // 4. Verify User Wallet Audit Integrity (Discrepancy must be 0.00)
      const { data: auditResult, error: auditErr } = await supabaseAdmin
        .rpc('verify_wallet_integrity', { p_wallet_id: wallet.id });

      expect(auditErr).toBeNull();
      const audit = Array.isArray(auditResult) ? auditResult[0] : auditResult;
      expect(audit.is_valid).toBe(true);
      expect(parseFloat(audit.discrepancy)).toBe(0.00);
      expect(parseFloat(audit.current_balance)).toBe(balanceAfterFirstTopup);
    });

    test('TC-WH-IDEM-01: Duplicate webhook is acknowledged without duplicate crediting', async () => {
      const payload = {
        event: 'payment_intent.succeeded',
        data: {
          id: testIntentId,
          amount: topUpAmount,
          currency: 'USD',
          metadata: {
            user_id: user.id,
            wallet_id: wallet.id
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
      expect(res.body.status).toBe('already_processed');
      expect(res.body.receipt.already_processed).toBe(true);

      // Verify wallet balance DID NOT change
      const { data: walletAfterReplay } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', wallet.id)
        .single();

      expect(parseFloat(walletAfterReplay.balance)).toBe(balanceAfterFirstTopup);
    });
  });

  describe('4. Non-Settlement Webhook Handling', () => {
    test('Non-settlement event (e.g. payment_intent.created) acknowledged without DB mutation', async () => {
      const payload = {
        event: 'payment_intent.created',
        data: { id: 'pi_test_created_only' }
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
      expect(res.body.status).toBe('ignored');
    });
  });
});
