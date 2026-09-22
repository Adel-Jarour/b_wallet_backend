const request = require('supertest');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const app = require('../../src/app');
const { supabaseAdmin } = require('../../src/config/supabase');
const PinService = require('../../src/services/pin.service');
const { issueTransactionTicket, verifyTransactionTicket } = require('../../src/utils/ticket.util');
const { createClient } = require('@supabase/supabase-js');
const { env } = require('../../src/config/env');

jest.setTimeout(120000);

describe('Integration: P2P Atomic Fund Transfers (/api/v1/transfers)', () => {
  const testUsersToCleanup = [];
  const testTxIdsToCleanup = [];
  const testLedgerIdsToCleanup = [];
  const testIdempotencyKeysToCleanup = [];

  let senderUser, senderToken, senderWallet;
  let receiverUser, receiverToken, receiverWallet;
  let thirdPartyUser, thirdPartyToken;

  const senderEmail = `transfer_sender_${Date.now()}@bwallet.dev`;
  const receiverEmail = `transfer_rec_${Date.now()}@bwallet.dev`;
  const thirdPartyEmail = `transfer_third_${Date.now()}@bwallet.dev`;

  const senderPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
  const receiverPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;

  const password = 'Password123!';
  const validPin = '123456';
  const wrongPin = '999999';

  beforeAll(async () => {
    // 1. Register Sender
    const resSender = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: senderEmail,
        password,
        firstName: 'Alice',
        lastName: 'Sender'
      });
    expect(resSender.status).toBe(201);
    senderUser = resSender.body.data.user;
    testUsersToCleanup.push(senderUser.id);

    // Update phone number for sender
    await supabaseAdmin
      .from('profiles')
      .update({ phone_number: senderPhone })
      .eq('id', senderUser.id);

    // Login Sender
    const loginSender = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: senderEmail, password });
    expect(loginSender.status).toBe(200);
    senderToken = loginSender.body.data.accessToken;

    // Set up PIN for Sender
    await PinService.setupPin(senderUser.id, validPin);

    // 2. Register Receiver
    const resRec = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: receiverEmail,
        password,
        firstName: 'Bob',
        lastName: 'Receiver'
      });
    expect(resRec.status).toBe(201);
    receiverUser = resRec.body.data.user;
    testUsersToCleanup.push(receiverUser.id);

    // Update phone number for receiver
    await supabaseAdmin
      .from('profiles')
      .update({ phone_number: receiverPhone })
      .eq('id', receiverUser.id);

    // Login Receiver
    const loginRec = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: receiverEmail, password });
    expect(loginRec.status).toBe(200);
    receiverToken = loginRec.body.data.accessToken;

    // 3. Register Third Party User
    const resThird = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: thirdPartyEmail,
        password,
        firstName: 'Eve',
        lastName: 'Eavesdropper'
      });
    expect(resThird.status).toBe(201);
    thirdPartyUser = resThird.body.data.user;
    testUsersToCleanup.push(thirdPartyUser.id);

    const loginThird = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: thirdPartyEmail, password });
    thirdPartyToken = loginThird.body.data.accessToken;

    // Fetch initial wallets
    const { data: wSender } = await supabaseAdmin
      .from('wallets')
      .select('*')
      .eq('user_id', senderUser.id)
      .single();
    senderWallet = wSender;

    const { data: wRec } = await supabaseAdmin
      .from('wallets')
      .select('*')
      .eq('user_id', receiverUser.id)
      .single();
    receiverWallet = wRec;
  });

  afterAll(async () => {
    // Cleanup ledger entries
    if (testLedgerIdsToCleanup.length > 0) {
      await supabaseAdmin.from('ledger_entries').delete().in('id', testLedgerIdsToCleanup);
    }
    // Cleanup transactions
    if (testTxIdsToCleanup.length > 0) {
      await supabaseAdmin.from('transactions').delete().in('id', testTxIdsToCleanup);
    }
    // Cleanup idempotency keys
    if (testIdempotencyKeysToCleanup.length > 0) {
      await supabaseAdmin.from('idempotency_keys').delete().in('key', testIdempotencyKeysToCleanup);
    }
    // Cleanup used transaction tickets
    if (testUsersToCleanup.length > 0) {
      await supabaseAdmin.from('used_transaction_tickets').delete().in('user_id', testUsersToCleanup);
    }
    // Cleanup test users
    for (const uid of testUsersToCleanup) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(uid);
      } catch (err) {
        // ignore
      }
    }
  });

  describe('Security & Validation Requirements', () => {
    it('should reject transfer when unauthenticated (missing JWT)', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('X-Idempotency-Key', uuidv4())
        .send({
          receiver_phone: receiverPhone,
          amount: 50.00,
          category: 'Food',
          pin: validPin
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject transfer when X-Idempotency-Key header is missing', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          receiver_phone: receiverPhone,
          amount: 50.00,
          category: 'Food',
          pin: validPin
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_MISSING');
    });

    it('should reject transfer when X-Idempotency-Key is not a valid UUIDv4', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', 'not-a-valid-uuid')
        .send({
          receiver_phone: receiverPhone,
          amount: 50.00,
          category: 'Food',
          pin: validPin
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_INVALID');
    });

    it('should reject self-transfer attempt', async () => {
      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({
          receiver_phone: senderPhone, // Self phone
          amount: 10.00,
          category: 'Food',
          pin: validPin
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SELF_TRANSFER_NOT_ALLOWED');
    });

    it('should reject transfer when incorrect PIN is supplied', async () => {
      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({
          receiver_phone: receiverPhone,
          amount: 10.00,
          category: 'Food',
          pin: wrongPin
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INCORRECT_PIN');
    });

    it('should reject transfer exceeding single AML limit of $2,500.00', async () => {
      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({
          receiver_phone: receiverPhone,
          amount: 2500.01,
          category: 'Property',
          pin: validPin
        });

      expect(res.status).toBe(400);
    });

    it('should reject transfer with negative or zero amount', async () => {
      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({
          receiver_phone: receiverPhone,
          amount: -10.00,
          category: 'Food',
          pin: validPin
        });

      expect(res.status).toBe(400);
    });
  });

  describe('Core Financial Acceptance Tests (TC-TX-01, TC-TX-02, TC-IDEM-01)', () => {
    let lastSuccessfulTxRef;

    it('TC-TX-01: Attempt transfer exceeding sender balance -> rejects with HTTP 400 "Insufficient funds", 0 balance changes', async () => {
      // Set sender balance to $20.00
      await supabaseAdmin
        .from('wallets')
        .update({ balance: '20.00' })
        .eq('id', senderWallet.id);

      // Set receiver balance to $0.00
      await supabaseAdmin
        .from('wallets')
        .update({ balance: '0.00' })
        .eq('id', receiverWallet.id);

      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      // Attempt to transfer $50.00 with only $20.00 available
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({
          receiver_phone: receiverPhone,
          amount: 50.00,
          category: 'Food',
          note: 'Trying to overspend',
          pin: validPin
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');

      // Verify that balances have NOT changed (0 balance changes)
      const { data: checkSender } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', senderWallet.id)
        .single();
      expect(parseFloat(checkSender.balance)).toBe(20.00);

      const { data: checkRec } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', receiverWallet.id)
        .single();
      expect(parseFloat(checkRec.balance)).toBe(0.00);
    });

    it('TC-TX-02: Valid transfer with correct PIN -> sender debited, receiver credited, transaction COMPLETED, ledger entries balanced', async () => {
      // Set sender balance to $100.00 and receiver to $0.00
      await supabaseAdmin
        .from('wallets')
        .update({ balance: '100.00' })
        .eq('id', senderWallet.id);

      await supabaseAdmin
        .from('wallets')
        .update({ balance: '0.00' })
        .eq('id', receiverWallet.id);

      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const transferAmount = 45.50;

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({
          receiver_phone: receiverPhone,
          amount: transferAmount,
          category: 'Food',
          note: 'Dinner split',
          pin: validPin
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const receipt = res.body.data.receipt;
      expect(receipt).toBeDefined();
      expect(receipt.amount).toBe('45.50');
      expect(receipt.currency).toBe('USD');
      expect(receipt.status).toBe('COMPLETED');
      expect(receipt.category).toBe('Food');
      expect(receipt.senderBalanceAfter).toBe('54.50');
      expect(receipt.transactionReference).toMatch(/^TXN-\d{8}-[A-Z0-9]{8}$/);

      lastSuccessfulTxRef = receipt.transactionReference;
      testTxIdsToCleanup.push(receipt.transactionId);

      // Verify sender balance in DB = 100.00 - 45.50 = 54.50
      const { data: updatedSender } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', senderWallet.id)
        .single();
      expect(parseFloat(updatedSender.balance)).toBe(54.50);

      // Verify receiver balance in DB = 0.00 + 45.50 = 45.50
      const { data: updatedRec } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', receiverWallet.id)
        .single();
      expect(parseFloat(updatedRec.balance)).toBe(45.50);

      // Verify double-entry ledger entries exist and balance perfectly
      const { data: ledgerRows } = await supabaseAdmin
        .from('ledger_entries')
        .select('*')
        .eq('transaction_id', receipt.transactionId);

      expect(ledgerRows).toHaveLength(2);
      ledgerRows.forEach(row => testLedgerIdsToCleanup.push(row.id));

      const debitEntry = ledgerRows.find(r => r.direction === 'DEBIT');
      const creditEntry = ledgerRows.find(r => r.direction === 'CREDIT');

      expect(debitEntry).toBeDefined();
      expect(creditEntry).toBeDefined();
      expect(debitEntry.wallet_id).toBe(senderWallet.id);
      expect(parseFloat(debitEntry.amount)).toBe(transferAmount);
      expect(creditEntry.wallet_id).toBe(receiverWallet.id);
      expect(parseFloat(creditEntry.amount)).toBe(transferAmount);
    });

    it('TC-IDEM-01: Submit identical request with identical X-Idempotency-Key twice -> returns original receipt; second debit is blocked', async () => {
      // Re-set balances to $100.00 and $0.00
      await supabaseAdmin
        .from('wallets')
        .update({ balance: '100.00' })
        .eq('id', senderWallet.id);

      await supabaseAdmin
        .from('wallets')
        .update({ balance: '0.00' })
        .eq('id', receiverWallet.id);

      const fixedIdemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(fixedIdemKey);

      const payload = {
        receiver_phone: receiverPhone,
        amount: 30.00,
        category: 'Entertainment',
        note: 'Concert tickets',
        pin: validPin
      };

      // First submission (executed)
      const res1 = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', fixedIdemKey)
        .send(payload);

      expect(res1.status).toBe(201);
      const receipt1 = res1.body.data.receipt;
      testTxIdsToCleanup.push(receipt1.transactionId);

      // Second identical submission (should replay cache)
      const res2 = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', fixedIdemKey)
        .send(payload);

      expect(res2.status).toBe(201);
      const receipt2 = res2.body.data.receipt;

      // Receipts must be identical (same reference and ID)
      expect(receipt2.transactionId).toBe(receipt1.transactionId);
      expect(receipt2.transactionReference).toBe(receipt1.transactionReference);
      expect(receipt2.amount).toBe(receipt1.amount);

      // Sender balance must have been debited ONCE (100 - 30 = 70.00, NOT 40.00)
      const { data: finalSender } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', senderWallet.id)
        .single();
      expect(parseFloat(finalSender.balance)).toBe(70.00);

      // Receiver balance must have been credited ONCE (0 + 30 = 30.00, NOT 60.00)
      const { data: finalRec } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', receiverWallet.id)
        .single();
      expect(parseFloat(finalRec.balance)).toBe(30.00);
    });

    it('should reject idempotency key reuse with conflicting payload (422)', async () => {
      const fixedIdemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(fixedIdemKey);

      // First submission with $10
      const res1 = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', fixedIdemKey)
        .send({
          receiver_phone: receiverPhone,
          amount: 10.00,
          category: 'Food',
          pin: validPin
        });
      expect(res1.status).toBe(201);
      testTxIdsToCleanup.push(res1.body.data.receipt.transactionId);

      // Second submission with DIFFERENT amount ($20) but SAME key
      const res2 = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', fixedIdemKey)
        .send({
          receiver_phone: receiverPhone,
          amount: 20.00,
          category: 'Food',
          pin: validPin
        });

      expect(res2.status).toBe(422);
      expect(res2.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    });

    it('Concurrent transfers test: Run 5 simultaneous $50 transfer requests with $100 starting balance -> exactly 2 succeed, 3 fail with insufficient balance; final balance is $0.00', async () => {
      // Set sender balance to exactly $100.00
      await supabaseAdmin
        .from('wallets')
        .update({ balance: '100.00' })
        .eq('id', senderWallet.id);

      // Reset receiver balance to $0.00
      await supabaseAdmin
        .from('wallets')
        .update({ balance: '0.00' })
        .eq('id', receiverWallet.id);

      // Prepare 5 parallel requests each requesting $50 with unique idempotency keys
      const promises = Array.from({ length: 5 }).map((_, i) => {
        const idemKey = uuidv4();
        testIdempotencyKeysToCleanup.push(idemKey);

        return request(app)
          .post('/api/v1/transfers')
          .set('Authorization', `Bearer ${senderToken}`)
          .set('X-Idempotency-Key', idemKey)
          .send({
            receiver_phone: receiverPhone,
            amount: 50.00,
            category: 'Hobby',
            note: `Concurrent request #${i + 1}`,
            pin: validPin
          });
      });

      const results = await Promise.all(promises);

      const successful = results.filter(r => r.status === 201);
      const failed = results.filter(r => r.status === 400);

      // Clean up successful transaction IDs
      successful.forEach(r => testTxIdsToCleanup.push(r.body.data.receipt.transactionId));

      // Exactly 2 must succeed ($50 * 2 = $100)
      expect(successful.length).toBe(2);

      // The remaining 3 must fail due to insufficient funds
      expect(failed.length).toBe(3);
      failed.forEach(r => {
        expect(r.body.error.code).toBe('INSUFFICIENT_FUNDS');
      });

      // Final balance of sender must be strictly $0.00 (no overdraft, no double debit)
      const { data: checkSender } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', senderWallet.id)
        .single();
      expect(parseFloat(checkSender.balance)).toBe(0.00);

      // Final balance of receiver must be strictly $100.00
      const { data: checkRec } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', receiverWallet.id)
        .single();
      expect(parseFloat(checkRec.balance)).toBe(100.00);
    });
  });

  describe('GET /api/v1/transfers/:reference Receipt Lookup', () => {
    let testTxRef;

    beforeAll(async () => {
      // Execute a quick transfer to have a known reference
      await supabaseAdmin
        .from('wallets')
        .update({ balance: '100.00' })
        .eq('id', senderWallet.id);

      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({
          receiver_email: receiverEmail,
          amount: 15.00,
          category: 'Expense',
          note: 'Coffee meeting',
          pin: validPin
        });

      expect(res.status).toBe(201);
      testTxRef = res.body.data.receipt.transactionReference;
      testTxIdsToCleanup.push(res.body.data.receipt.transactionId);
    });

    it('should allow sender to view the transfer receipt', async () => {
      const res = await request(app)
        .get(`/api/v1/transfers/${testTxRef}`)
        .set('Authorization', `Bearer ${senderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.receipt.transactionReference).toBe(testTxRef);
      expect(res.body.data.receipt.amount).toBe('15.00');
    });

    it('should allow receiver to view the transfer receipt', async () => {
      const res = await request(app)
        .get(`/api/v1/transfers/${testTxRef}`)
        .set('Authorization', `Bearer ${receiverToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.receipt.transactionReference).toBe(testTxRef);
    });

    it('should forbid an unrelated third party from viewing the receipt (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/transfers/${testTxRef}`)
        .set('Authorization', `Bearer ${thirdPartyToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('TRANSFER_ACCESS_DENIED');
    });

    it('should return 404 for a non-existent transaction reference', async () => {
      const res = await request(app)
        .get('/api/v1/transfers/TXN-00000000-NONEXIST')
        .set('Authorization', `Bearer ${senderToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TRANSFER_NOT_FOUND');
    });
  });

  describe('Double-Entry Ledger Fee Accounting (fee = 0 and fee > 0)', () => {
    it('fee = 0 -> ledger balanced: sender debited amount, receiver credited amount, exactly 2 ledger entries', async () => {
      // Set initial balances
      await supabaseAdmin.from('wallets').update({ balance: '100.00' }).eq('id', senderWallet.id);
      await supabaseAdmin.from('wallets').update({ balance: '50.00' }).eq('id', receiverWallet.id);

      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({
          receiver_phone: receiverPhone,
          amount: 25.00,
          fee: 0.00,
          category: 'Food',
          note: 'Zero fee transfer',
          pin: validPin
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const receipt = res.body.data.receipt;
      testTxIdsToCleanup.push(receipt.transactionId);
      expect(receipt.amount).toBe('25.00');
      expect(receipt.fee).toBe('0.00');
      expect(receipt.senderBalanceAfter).toBe('75.00');

      // Verify wallet balances
      const { data: sW } = await supabaseAdmin.from('wallets').select('balance').eq('id', senderWallet.id).single();
      const { data: rW } = await supabaseAdmin.from('wallets').select('balance').eq('id', receiverWallet.id).single();
      expect(parseFloat(sW.balance)).toBe(75.00);
      expect(parseFloat(rW.balance)).toBe(75.00);

      // Verify ledger entries
      const { data: entries } = await supabaseAdmin
        .from('ledger_entries')
        .select('*')
        .eq('transaction_id', receipt.transactionId);

      expect(entries).toHaveLength(2);
      entries.forEach(e => testLedgerIdsToCleanup.push(e.id));

      const debitEntry = entries.find(e => e.direction === 'DEBIT');
      const creditEntry = entries.find(e => e.direction === 'CREDIT');

      expect(debitEntry.wallet_id).toBe(senderWallet.id);
      expect(parseFloat(debitEntry.amount)).toBe(25.00);
      expect(creditEntry.wallet_id).toBe(receiverWallet.id);
      expect(parseFloat(creditEntry.amount)).toBe(25.00);

      // Ledger is mathematically balanced
      expect(parseFloat(debitEntry.amount)).toBe(parseFloat(creditEntry.amount));
    });

    it('fee > 0 -> ledger balanced with explicit fee accounting: sender debited amount+fee, receiver credited amount, fee wallet credited fee', async () => {
      // Fetch system fee wallet
      const { data: feeWalletBefore } = await supabaseAdmin
        .from('wallets')
        .select('*')
        .eq('wallet_type', 'SYSTEM_FEE')
        .eq('currency', 'USD')
        .single();
      expect(feeWalletBefore).toBeDefined();

      // Record initial fee wallet balance (respecting immutable ledger entries from Sprint 9 trigger)
      const initialFeeBalance = parseFloat(feeWalletBefore.balance);

      // Set sender = $100.00, receiver = $10.00
      await supabaseAdmin.from('wallets').update({ balance: '100.00' }).eq('id', senderWallet.id);
      await supabaseAdmin.from('wallets').update({ balance: '10.00' }).eq('id', receiverWallet.id);

      const transferAmount = 50.00;
      const transferFee = 2.50;
      const totalExpectedDebit = transferAmount + transferFee; // 52.50

      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({
          receiver_phone: receiverPhone,
          amount: transferAmount,
          fee: transferFee,
          category: 'Expense',
          note: 'Transfer with explicit fee',
          pin: validPin
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const receipt = res.body.data.receipt;
      testTxIdsToCleanup.push(receipt.transactionId);
      expect(receipt.amount).toBe('50.00');
      expect(receipt.fee).toBe('2.50');
      expect(receipt.senderBalanceAfter).toBe('47.50'); // 100 - 52.50

      // 1. Sender balance decreases by amount + fee
      const { data: sW } = await supabaseAdmin.from('wallets').select('balance').eq('id', senderWallet.id).single();
      expect(parseFloat(sW.balance)).toBe(47.50);

      // 2. Receiver balance increases by amount
      const { data: rW } = await supabaseAdmin.from('wallets').select('balance').eq('id', receiverWallet.id).single();
      expect(parseFloat(rW.balance)).toBe(60.00); // 10 + 50

      // 3. Fee wallet balance increases by fee
      const { data: fW } = await supabaseAdmin.from('wallets').select('balance').eq('id', feeWalletBefore.id).single();
      expect(parseFloat(fW.balance)).toBeCloseTo(initialFeeBalance + transferFee, 2);

      // 4. Verify double-entry ledger entries (exactly 3 entries)
      const { data: entries } = await supabaseAdmin
        .from('ledger_entries')
        .select('*')
        .eq('transaction_id', receipt.transactionId);

      expect(entries).toHaveLength(3);
      entries.forEach(e => testLedgerIdsToCleanup.push(e.id));

      const senderDebit = entries.find(e => e.wallet_id === senderWallet.id && e.direction === 'DEBIT');
      const receiverCredit = entries.find(e => e.wallet_id === receiverWallet.id && e.direction === 'CREDIT');
      const feeCredit = entries.find(e => e.wallet_id === feeWalletBefore.id && e.direction === 'CREDIT');

      expect(senderDebit).toBeDefined();
      expect(receiverCredit).toBeDefined();
      expect(feeCredit).toBeDefined();

      expect(parseFloat(senderDebit.amount)).toBe(totalExpectedDebit);
      expect(parseFloat(receiverCredit.amount)).toBe(transferAmount);
      expect(parseFloat(feeCredit.amount)).toBe(transferFee);

      // Mathematical balance verification: Sum(DEBIT) === Sum(CREDIT)
      const totalDebits = parseFloat(senderDebit.amount);
      const totalCredits = parseFloat(receiverCredit.amount) + parseFloat(feeCredit.amount);
      expect(totalDebits).toBe(totalCredits);

      // 5. Fee amount is accounted for exactly once
      const feeEntries = entries.filter(e => e.wallet_id === feeWalletBefore.id);
      expect(feeEntries).toHaveLength(1);

      // 6. Verify mathematical audit via verify_wallet_integrity RPC for system fee wallet
      const { data: auditFee } = await supabaseAdmin.rpc('verify_wallet_integrity', { p_wallet_id: feeWalletBefore.id });
      expect(auditFee[0].is_valid).toBe(true);
      expect(parseFloat(auditFee[0].discrepancy)).toBe(0.00);

      // Verify that the net balance change of all wallets equals exactly zero:
      // Sender delta (-52.50) + Receiver delta (+50.00) + Fee delta (+2.50) === 0.00
      const senderDelta = parseFloat(sW.balance) - 100.00;
      const receiverDelta = parseFloat(rW.balance) - 10.00;
      const feeDelta = parseFloat(fW.balance) - initialFeeBalance;
      expect(senderDelta + receiverDelta + feeDelta).toBeCloseTo(0.00, 2);
      expect(auditFee[0].is_valid).toBe(true);
      expect(parseFloat(auditFee[0].discrepancy)).toBe(0.00);
    });

    it('failed transfer causes zero balance/ledger mutation across sender, receiver, and fee wallet', async () => {
      // Sender has $50. Transfer requires $50 amount + $2 fee = $52 (insufficient balance)
      await supabaseAdmin.from('wallets').update({ balance: '50.00' }).eq('id', senderWallet.id);
      await supabaseAdmin.from('wallets').update({ balance: '20.00' }).eq('id', receiverWallet.id);

      const { data: feeWBefore } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('wallet_type', 'SYSTEM_FEE')
        .eq('currency', 'USD')
        .single();
      const initialFeeBalance = parseFloat(feeWBefore.balance);

      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({
          receiver_phone: receiverPhone,
          amount: 50.00,
          fee: 2.00,
          category: 'Food',
          pin: validPin
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');

      // Verify zero balance mutations
      const { data: sW } = await supabaseAdmin.from('wallets').select('balance').eq('id', senderWallet.id).single();
      const { data: rW } = await supabaseAdmin.from('wallets').select('balance').eq('id', receiverWallet.id).single();
      const { data: fW } = await supabaseAdmin.from('wallets').select('balance').eq('id', feeWBefore.id || '00000000-0000-0000-0000-000000000001').single();

      expect(parseFloat(sW.balance)).toBe(50.00);
      expect(parseFloat(rW.balance)).toBe(20.00);
      expect(parseFloat(fW.balance)).toBe(initialFeeBalance);

      // Verify no transaction record was inserted
      const { data: txRecord } = await supabaseAdmin
        .from('transactions')
        .select('id')
        .eq('idempotency_key', idemKey);
      expect(txRecord).toHaveLength(0);
    });
  });

  describe('Transaction Ticket Security & Replay Prevention', () => {
    it('single-use enforcement: a valid transaction ticket CANNOT be reused for a second transfer', async () => {
      // Set sender balance
      await supabaseAdmin.from('wallets').update({ balance: '100.00' }).eq('id', senderWallet.id);

      // Issue a ticket via PIN verification
      const verifyRes = await request(app)
        .post('/api/v1/auth/pin/verify')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ pin: validPin });

      expect(verifyRes.status).toBe(200);
      const ticket = verifyRes.body.data.ticket;
      expect(ticket).toBeDefined();

      // First transfer with ticket: MUST succeed
      const idemKey1 = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey1);

      const res1 = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idemKey1)
        .send({
          receiver_phone: receiverPhone,
          amount: 10.00,
          category: 'Entertainment',
          note: '1st transfer using ticket',
          transactionTicket: ticket
        });

      expect(res1.status).toBe(201);
      testTxIdsToCleanup.push(res1.body.data.receipt.transactionId);

      // Second transfer reusing the SAME ticket: MUST be rejected
      const idemKey2 = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey2);

      const res2 = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idemKey2)
        .send({
          receiver_phone: receiverPhone,
          amount: 10.00,
          category: 'Entertainment',
          note: 'Reusing consumed ticket',
          transactionTicket: ticket
        });

      expect(res2.status).toBe(401);
      expect(res2.body.error.code).toBe('TICKET_ALREADY_USED');
    });

    it('user binding: a ticket issued to User A cannot authorize a transfer for User B', async () => {
      // Issue ticket for User A (sender)
      const ticketA = issueTransactionTicket(senderUser.id);

      // User B (receiver/third party) attempts to use User A's ticket
      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${receiverToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({
          receiver_phone: senderPhone,
          amount: 5.00,
          category: 'Food',
          transactionTicket: ticketA
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TICKET_INVALID');
    });

    it('expired ticket is rejected', async () => {
      // Issue ticket and forge expiration in the past
      const expiredPayload = {
        jti: uuidv4(),
        userId: senderUser.id,
        purpose: 'TRANSACTION',
        authorizedAt: Date.now() - 600000,
        expiresAt: Date.now() - 60000 // expired 1 minute ago
      };

      const payloadEncoded = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
      const signature = crypto
        .createHmac('sha256', process.env.TRANSACTION_TICKET_SECRET || env.SUPABASE_SERVICE_ROLE_KEY)
        .update(payloadEncoded)
        .digest('base64url');
      const expiredTicket = `${payloadEncoded}.${signature}`;

      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({
          receiver_phone: receiverPhone,
          amount: 5.00,
          category: 'Food',
          transactionTicket: expiredTicket
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TICKET_INVALID');
    });

    it('parameter binding: ticket bound to a specific transfer rejects transfers with altered parameters', async () => {
      // Issue ticket bound to amount 10.00 and receiverUser.id
      const boundTicket = issueTransactionTicket(senderUser.id, {
        boundTransferParams: {
          amount: 10.00,
          receiverId: receiverUser.id
        }
      });

      // Attempt transfer with DIFFERENT amount (20.00) using the bound ticket
      const idemKey = uuidv4();
      testIdempotencyKeysToCleanup.push(idemKey);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idemKey)
        .send({
          receiver_phone: receiverPhone,
          amount: 20.00, // altered amount!
          category: 'Food',
          transactionTicket: boundTicket
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TICKET_INVALID');
    });
  });

  describe('SECURITY DEFINER Hardening & RPC Boundary Authorization', () => {
    it('direct RPC invocation without service_role credentials is rejected at database engine level', async () => {
      // Direct HTTP call to RPC without service_role key
      const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/transfer_funds_atomic`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: 'invalid-or-anon-key'
        },
        body: JSON.stringify({
          p_sender_id: senderUser.id,
          p_receiver_id: receiverUser.id,
          p_amount: 10.00,
          p_fee: 0.00,
          p_currency: 'USD',
          p_category: 'Food',
          p_note: 'Direct RPC exploit attempt',
          p_idempotency_key: uuidv4(),
          p_tx_reference: 'TXN-ANON-EXPLOIT'
        })
      });

      // Must be rejected with 401 Unauthorized or 403 Forbidden
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('RPC boundary rejects execution when caller attempts impersonation', async () => {
      // Direct call authenticated as User B but attempting to debit User A
      const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/transfer_funds_atomic`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${receiverToken}` // User B JWT
        },
        body: JSON.stringify({
          p_sender_id: senderUser.id, // Forged User A sender
          p_receiver_id: receiverUser.id,
          p_amount: 10.00,
          p_fee: 0.00,
          p_currency: 'USD',
          p_category: 'Food',
          p_note: 'Impersonation exploit attempt',
          p_idempotency_key: uuidv4(),
          p_tx_reference: 'TXN-IMPERSONATE-EXPLOIT'
        })
      });

      // Must be rejected by database boundary check (auth.uid() != p_sender_id)
      expect(response.status).toBeGreaterThanOrEqual(400);
      const errBody = await response.json();
      expect(JSON.stringify(errBody)).toMatch(/Authorization violation|permission denied/i);
    });
  });
});

