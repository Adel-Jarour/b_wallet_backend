const request = require('supertest');
const app = require('../../src/app');
const { supabaseAdmin } = require('../../src/config/supabase');

describe('Integration: Digital Wallet & Double-Entry Ledger Subsystem (/api/v1/wallets)', () => {
  const testUsersToCleanup = [];
  const testTxIdsToCleanup = [];
  const testLedgerIdsToCleanup = [];

  let userA, tokenA, walletA;
  let userB, tokenB, walletB;

  const emailA = `wallet_user_a_${Date.now()}@bwallet.dev`;
  const emailB = `wallet_user_b_${Date.now()}@bwallet.dev`;
  const password = 'Password123!';

  beforeAll(async () => {
    // 1. Register User A
    const resA = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: emailA,
        password,
        firstName: 'Alice',
        lastName: 'Auditor'
      });
    expect(resA.status).toBe(201);
    userA = resA.body.data.user;
    testUsersToCleanup.push(userA.id);

    // Login User A to get valid access token
    const loginA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailA, password });
    expect(loginA.status).toBe(200);
    tokenA = loginA.body.data.accessToken;

    // Fetch Wallet A from DB
    const { data: wA } = await supabaseAdmin
      .from('wallets')
      .select('*')
      .eq('user_id', userA.id)
      .single();
    walletA = wA;

    // 2. Register User B
    const resB = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: emailB,
        password,
        firstName: 'Bob',
        lastName: 'Banker'
      });
    expect(resB.status).toBe(201);
    userB = resB.body.data.user;
    testUsersToCleanup.push(userB.id);

    // Login User B to get valid access token
    const loginB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailB, password });
    expect(loginB.status).toBe(200);
    tokenB = loginB.body.data.accessToken;

    // Fetch Wallet B from DB
    const { data: wB } = await supabaseAdmin
      .from('wallets')
      .select('*')
      .eq('user_id', userB.id)
      .single();
    walletB = wB;
  }, 35000);

  afterAll(async () => {
    // Cleanup ledger entries
    if (testLedgerIdsToCleanup.length > 0) {
      await supabaseAdmin.from('ledger_entries').delete().in('id', testLedgerIdsToCleanup);
    }
    // Cleanup transactions
    if (testTxIdsToCleanup.length > 0) {
      await supabaseAdmin.from('transactions').delete().in('id', testTxIdsToCleanup);
    }
    // Cleanup test users
    for (const id of testUsersToCleanup) {
      try {
        await supabaseAdmin.from('wallets').delete().eq('user_id', id);
        await supabaseAdmin.from('profiles').delete().eq('id', id);
        await supabaseAdmin.auth.admin.deleteUser(id);
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  }, 25000);

  // ==========================================================================
  // GET /api/v1/wallets/me
  // ==========================================================================
  describe('GET /api/v1/wallets/me', () => {
    test('should reject request without Bearer token (HTTP 401)', async () => {
      const response = await request(app).get('/api/v1/wallets/me');
      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTH_HEADER_MISSING');
    });

    test('should retrieve active wallet with 2-decimal precision for authenticated user', async () => {
      const response = await request(app)
        .get('/api/v1/wallets/me')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.wallet).toBeDefined();

      const { wallet } = response.body.data;
      expect(wallet.id).toBe(walletA.id);
      expect(wallet.userId).toBe(userA.id);
      expect(wallet.currency).toBe('USD');
      expect(wallet.balance).toBe('0.00'); // Exact 2 decimal string
      expect(wallet.status).toBe('ACTIVE');
      expect(wallet.createdAt).toBeDefined();
    }, 10000);

    test('should guarantee User A cannot see User B\'s wallet', async () => {
      const responseA = await request(app)
        .get('/api/v1/wallets/me')
        .set('Authorization', `Bearer ${tokenA}`);

      const responseB = await request(app)
        .get('/api/v1/wallets/me')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(responseA.body.data.wallet.id).not.toBe(responseB.body.data.wallet.id);
      expect(responseA.body.data.wallet.userId).toBe(userA.id);
      expect(responseB.body.data.wallet.userId).toBe(userB.id);
    }, 10000);
  });

  // ==========================================================================
  // GET /api/v1/wallets/me/ledger
  // ==========================================================================
  describe('GET /api/v1/wallets/me/ledger', () => {
    test('should reject request without Bearer token (HTTP 401)', async () => {
      const response = await request(app).get('/api/v1/wallets/me/ledger');
      expect(response.status).toBe(401);
    });

    test('should return empty entries array with valid pagination for newly created wallet', async () => {
      const response = await request(app)
        .get('/api/v1/wallets/me/ledger')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.entries).toEqual([]);
      expect(response.body.data.pagination).toEqual({
        page: 1,
        limit: 20,
        totalItems: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false
      });
    }, 10000);

    test('should reject invalid pagination parameters (page < 1 or limit > 100)', async () => {
      const resInvalidPage = await request(app)
        .get('/api/v1/wallets/me/ledger?page=0')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(resInvalidPage.status).toBe(400);
      expect(resInvalidPage.body.error.code).toBe('VALIDATION_ERROR');

      const resInvalidLimit = await request(app)
        .get('/api/v1/wallets/me/ledger?limit=101')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(resInvalidLimit.status).toBe(400);
      expect(resInvalidLimit.body.error.code).toBe('VALIDATION_ERROR');

      const resInvalidDirection = await request(app)
        .get('/api/v1/wallets/me/ledger?direction=INVALID')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(resInvalidDirection.status).toBe(400);
      expect(resInvalidDirection.body.error.code).toBe('VALIDATION_ERROR');
    }, 10000);

    describe('With Double-Entry Records Seeded', () => {
      let tx1Id, tx2Id;

      beforeAll(async () => {
        // Create 2 sample transactions with ledger entries via admin to test retrieval & pagination
        // Tx 1: Top-Up $100.00 into Wallet A
        const { data: tx1 } = await supabaseAdmin
          .from('transactions')
          .insert({
            transaction_reference: `TXN-TEST-001-${Date.now()}`,
            receiver_id: userA.id,
            amount: 100.00,
            fee: 0.00,
            currency: 'USD',
            type: 'TOP_UP',
            status: 'COMPLETED',
            category: 'TopUp'
          })
          .select()
          .single();
        tx1Id = tx1.id;
        testTxIdsToCleanup.push(tx1Id);

        const { data: le1 } = await supabaseAdmin
          .from('ledger_entries')
          .insert({
            transaction_id: tx1Id,
            wallet_id: walletA.id,
            direction: 'CREDIT',
            amount: 100.00
          })
          .select()
          .single();
        testLedgerIdsToCleanup.push(le1.id);

        // Tx 2: P2P Transfer: User A sends $30.00 to User B
        const { data: tx2 } = await supabaseAdmin
          .from('transactions')
          .insert({
            transaction_reference: `TXN-TEST-002-${Date.now()}`,
            sender_id: userA.id,
            receiver_id: userB.id,
            amount: 30.00,
            fee: 0.00,
            currency: 'USD',
            type: 'TRANSFER',
            status: 'COMPLETED',
            category: 'Food'
          })
          .select()
          .single();
        tx2Id = tx2.id;
        testTxIdsToCleanup.push(tx2Id);

        // Balanced double-entry records
        const { data: leDebitA } = await supabaseAdmin
          .from('ledger_entries')
          .insert({
            transaction_id: tx2Id,
            wallet_id: walletA.id,
            direction: 'DEBIT',
            amount: 30.00
          })
          .select()
          .single();
        testLedgerIdsToCleanup.push(leDebitA.id);

        const { data: leCreditB } = await supabaseAdmin
          .from('ledger_entries')
          .insert({
            transaction_id: tx2Id,
            wallet_id: walletB.id,
            direction: 'CREDIT',
            amount: 30.00
          })
          .select()
          .single();
        testLedgerIdsToCleanup.push(leCreditB.id);

        // Update wallet balances in DB to match ledger
        // Wallet A: 100 - 30 = 70.00
        await supabaseAdmin
          .from('wallets')
          .update({ balance: 70.00 })
          .eq('id', walletA.id);

        // Wallet B: 0 + 30 = 30.00
        await supabaseAdmin
          .from('wallets')
          .update({ balance: 30.00 })
          .eq('id', walletB.id);
      }, 30000);

      test('should retrieve User A\'s ledger entries with associated transaction details', async () => {
        const response = await request(app)
          .get('/api/v1/wallets/me/ledger')
          .set('Authorization', `Bearer ${tokenA}`);

        expect(response.status).toBe(200);
        expect(response.body.data.entries.length).toBe(2);

        // Assert deterministic ordering (most recent first)
        const entries = response.body.data.entries;
        expect(entries[0].direction).toBe('DEBIT');
        expect(entries[0].amount).toBe('30.00');
        expect(entries[0].transaction).toBeDefined();
        expect(entries[0].transaction.reference).toContain('TXN-TEST-002');
        expect(entries[0].transaction.type).toBe('TRANSFER');

        expect(entries[1].direction).toBe('CREDIT');
        expect(entries[1].amount).toBe('100.00');
        expect(entries[1].transaction.type).toBe('TOP_UP');
      }, 15000);

      test('should support pagination limit and page traversal', async () => {
        // Page 1 with limit 1
        const page1 = await request(app)
          .get('/api/v1/wallets/me/ledger?page=1&limit=1')
          .set('Authorization', `Bearer ${tokenA}`);

        expect(page1.status).toBe(200);
        expect(page1.body.data.entries.length).toBe(1);
        expect(page1.body.data.pagination.page).toBe(1);
        expect(page1.body.data.pagination.limit).toBe(1);
        expect(page1.body.data.pagination.totalItems).toBe(2);
        expect(page1.body.data.pagination.totalPages).toBe(2);
        expect(page1.body.data.pagination.hasNextPage).toBe(true);
        expect(page1.body.data.pagination.hasPrevPage).toBe(false);

        // Page 2 with limit 1
        const page2 = await request(app)
          .get('/api/v1/wallets/me/ledger?page=2&limit=1')
          .set('Authorization', `Bearer ${tokenA}`);

        expect(page2.status).toBe(200);
        expect(page2.body.data.entries.length).toBe(1);
        expect(page2.body.data.entries[0].id).not.toBe(page1.body.data.entries[0].id);
        expect(page2.body.data.pagination.hasNextPage).toBe(false);
        expect(page2.body.data.pagination.hasPrevPage).toBe(true);
      }, 15000);

      test('should support direction filtering (CREDIT vs DEBIT)', async () => {
        const creditRes = await request(app)
          .get('/api/v1/wallets/me/ledger?direction=CREDIT')
          .set('Authorization', `Bearer ${tokenA}`);

        expect(creditRes.status).toBe(200);
        expect(creditRes.body.data.entries.length).toBe(1);
        expect(creditRes.body.data.entries[0].direction).toBe('CREDIT');

        const debitRes = await request(app)
          .get('/api/v1/wallets/me/ledger?direction=DEBIT')
          .set('Authorization', `Bearer ${tokenA}`);

        expect(debitRes.status).toBe(200);
        expect(debitRes.body.data.entries.length).toBe(1);
        expect(debitRes.body.data.entries[0].direction).toBe('DEBIT');
      }, 15000);

      test('should isolate ledger data: User B cannot see User A\'s ledger entries', async () => {
        const responseB = await request(app)
          .get('/api/v1/wallets/me/ledger')
          .set('Authorization', `Bearer ${tokenB}`);

        expect(responseB.status).toBe(200);
        expect(responseB.body.data.entries.length).toBe(1);
        expect(responseB.body.data.entries[0].direction).toBe('CREDIT');
        expect(responseB.body.data.entries[0].amount).toBe('30.00');
        expect(responseB.body.data.entries[0].walletId).toBe(walletB.id);
      }, 15000);
    });
  });

  // ==========================================================================
  // GET /api/v1/wallets/me/audit
  // ==========================================================================
  describe('GET /api/v1/wallets/me/audit', () => {
    test('should reject request without Bearer token (HTTP 401)', async () => {
      const response = await request(app).get('/api/v1/wallets/me/audit');
      expect(response.status).toBe(401);
    });

    test('should verify integrity for a balanced wallet (isValid: true, discrepancy: 0.00)', async () => {
      // User A balance was set to 70.00, and ledger has CREDIT 100.00, DEBIT 30.00 -> 70.00
      const response = await request(app)
        .get('/api/v1/wallets/me/audit')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const audit = response.body.data;
      expect(audit.walletId).toBe(walletA.id);
      expect(audit.currency).toBe('USD');
      expect(audit.currentBalance).toBe('70.00');
      expect(audit.calculatedBalance).toBe('70.00');
      expect(audit.totalCredits).toBe('100.00');
      expect(audit.totalDebits).toBe('30.00');
      expect(audit.entryCount).toBe(2);
      expect(audit.discrepancy).toBe('0.00');
      expect(audit.isValid).toBe(true);
      expect(audit.status).toBe('HEALTHY');
    }, 15000);

    test('should detect financial discrepancy when wallet balance does not match ledger sum', async () => {
      // Intentionally tamper with wallet A balance via admin to simulate an unauthorized mutation / corruption
      await supabaseAdmin
        .from('wallets')
        .update({ balance: 99.99 }) // Ledger says 70.00, but balance says 99.99
        .eq('id', walletA.id);

      const response = await request(app)
        .get('/api/v1/wallets/me/audit')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      const audit = response.body.data;

      expect(audit.currentBalance).toBe('99.99');
      expect(audit.calculatedBalance).toBe('70.00');
      expect(audit.discrepancy).toBe('29.99'); // 99.99 - 70.00
      expect(audit.isValid).toBe(false);
      expect(audit.status).toBe('DISCREPANCY_DETECTED');

      // CRITICAL FINTECH REQUIREMENT: Must NOT silently repair the balance!
      const { data: checkWallet } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('id', walletA.id)
        .single();
      expect(parseFloat(checkWallet.balance)).toBe(99.99); // Remains unchanged, preserved for audit investigation

      // Restore wallet balance to 70.00 for subsequent tests
      await supabaseAdmin
        .from('wallets')
        .update({ balance: 70.00 })
        .eq('id', walletA.id);
    }, 15000);
  });

  // ==========================================================================
  // Row Level Security (RLS) & Immutability Verification
  // ==========================================================================
  describe('Row Level Security & Anti-Tampering Constraints', () => {
    test('database RLS blocks client direct mutation of wallet balance', async () => {
      // Query pg_policies to confirm no UPDATE policy exists for wallets
      const { data: policies } = await supabaseAdmin
        .rpc('query_sql', {
          sql_query: "SELECT policyname, cmd FROM pg_policies WHERE tablename = 'wallets' AND cmd = 'UPDATE'"
        });

      // No UPDATE policy exists = direct client updates are blocked by PostgreSQL RLS
      expect(policies).toHaveLength(0);
    }, 10000);

    test('database RLS blocks client direct mutation of transactions and ledger_entries', async () => {
      const { data: txPolicies } = await supabaseAdmin
        .rpc('query_sql', {
          sql_query: "SELECT policyname, cmd FROM pg_policies WHERE tablename = 'transactions' AND cmd IN ('UPDATE', 'DELETE', 'INSERT')"
        });
      expect(txPolicies).toHaveLength(0);

      const { data: ledgerPolicies } = await supabaseAdmin
        .rpc('query_sql', {
          sql_query: "SELECT policyname, cmd FROM pg_policies WHERE tablename = 'ledger_entries' AND cmd IN ('UPDATE', 'DELETE', 'INSERT')"
        });
      expect(ledgerPolicies).toHaveLength(0);
    }, 10000);
  });
});
