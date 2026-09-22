const request = require('supertest');
const crypto = require('crypto');
const app = require('../../src/app');
const { supabaseAdmin } = require('../../src/config/supabase');
const PinService = require('../../src/services/pin.service');
const { createClient } = require('@supabase/supabase-js');
const { env } = require('../../src/config/env');

/**
 * Derives the Supabase anon key from the service role key.
 * Both share the same JWT secret but with different role claims.
 */
function getAnonKey() {
  if (process.env.SUPABASE_ANON_KEY) return process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  const parts = serviceKey.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const anonPayload = { ...payload, role: 'anon' };
    const header = parts[0];
    const newPayload = Buffer.from(JSON.stringify(anonPayload)).toString('base64url');
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (jwtSecret) {
      const unsignedToken = `${header}.${newPayload}`;
      const signature = crypto.createHmac('sha256', jwtSecret).update(unsignedToken).digest('base64url');
      return `${unsignedToken}.${signature}`;
    }
  } catch (e) { /* ignore */ }
  return null;
}

jest.setTimeout(120000);

describe('Integration: Real-Time Messaging & Conversations (/api/v1/conversations)', () => {
  const testUsersToCleanup = [];
  const testConvoIdsToCleanup = [];
  const testTxIdsToCleanup = [];
  const testLedgerIdsToCleanup = [];

  let userA, tokenA;
  let userB, tokenB;
  let userC, tokenC; // Third-party unauthorized user

  const emailA = `chat_alice_${Date.now()}@bwallet.dev`;
  const emailB = `chat_bob_${Date.now()}@bwallet.dev`;
  const emailC = `chat_charlie_${Date.now()}@bwallet.dev`;
  const password = 'Password123!';
  const pin = '123456';

  let activeConversationId;
  let sampleTransactionId;

  beforeAll(async () => {
    // 1. Register and Login User A
    const resA = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: emailA, password, firstName: 'Alice', lastName: 'Chat' });
    expect(resA.status).toBe(201);
    userA = resA.body.data.user;
    testUsersToCleanup.push(userA.id);

    const loginA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailA, password });
    tokenA = loginA.body.data.accessToken;
    await PinService.setupPin(userA.id, pin);

    // 2. Register and Login User B
    const resB = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: emailB, password, firstName: 'Bob', lastName: 'Chat' });
    expect(resB.status).toBe(201);
    userB = resB.body.data.user;
    testUsersToCleanup.push(userB.id);

    const loginB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailB, password });
    tokenB = loginB.body.data.accessToken;
    await PinService.setupPin(userB.id, pin);

    // 3. Register and Login User C
    const resC = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: emailC, password, firstName: 'Charlie', lastName: 'Chat' });
    expect(resC.status).toBe(201);
    userC = resC.body.data.user;
    testUsersToCleanup.push(userC.id);

    const loginC = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailC, password });
    tokenC = loginC.body.data.accessToken;

    // 4. Seed a completed transaction for embedded card test
    const txRef = `TXN-CHAT-${Date.now()}`;
    const { data: tx, error: txErr } = await supabaseAdmin
      .from('transactions')
      .insert({
        transaction_reference: txRef,
        sender_id: userA.id,
        receiver_id: userB.id,
        amount: 25.00,
        fee: 0.00,
        currency: 'USD',
        category: 'Food',
        type: 'TRANSFER',
        status: 'COMPLETED',
        note: 'Pizza dinner'
      })
      .select('id')
      .single();

    if (txErr) {
      console.error('Error creating seed transaction:', txErr);
    }

    if (tx) {
      sampleTransactionId = tx.id;
      testTxIdsToCleanup.push(tx.id);
    }
  });

  afterAll(async () => {
    // Delete messages
    if (testConvoIdsToCleanup.length > 0) {
      await supabaseAdmin.from('messages').delete().in('conversation_id', testConvoIdsToCleanup);
      await supabaseAdmin.from('conversations').delete().in('id', testConvoIdsToCleanup);
    }
    // Delete transactions
    if (testTxIdsToCleanup.length > 0) {
      await supabaseAdmin.from('transactions').delete().in('id', testTxIdsToCleanup);
    }
    // Delete users
    for (const uid of testUsersToCleanup) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(uid);
      } catch (e) {
        // ignore
      }
    }
  });

  describe('POST /api/v1/conversations — Start or Get Conversation', () => {
    it('successfully creates a conversation between User A and User B', async () => {
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ participantId: userB.id });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.counterparty.id).toBe(userB.id);
      expect(res.body.data.counterparty.fullName).toBe('Bob Chat');

      activeConversationId = res.body.data.id;
      testConvoIdsToCleanup.push(activeConversationId);
    });

    it('idempotently returns the existing conversation when requested again', async () => {
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ participantId: userA.id });

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(activeConversationId);
      expect(res.body.data.counterparty.id).toBe(userA.id);
    });

    it('rejects attempt to start conversation with oneself (400)', async () => {
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ participantId: userA.id });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SELF_CONVERSATION_NOT_ALLOWED');
    });

    it('rejects attempt with non-existent participant ID (404)', async () => {
      const fakeUuid = crypto.randomUUID();
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ participantId: fakeUuid });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('rejects unauthenticated request (401)', async () => {
      const res = await request(app)
        .post('/api/v1/conversations')
        .send({ participantId: userB.id });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/conversations — List Conversations', () => {
    it('returns active conversations with preview and counterparty details for User A', async () => {
      const res = await request(app)
        .get('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.conversations).toBeInstanceOf(Array);
      expect(res.body.data.conversations.length).toBeGreaterThanOrEqual(1);

      const found = res.body.data.conversations.find(c => c.id === activeConversationId);
      expect(found).toBeDefined();
      expect(found.counterparty.id).toBe(userB.id);
    });

    it('returns empty conversation list for User C', async () => {
      const res = await request(app)
        .get('/api/v1/conversations')
        .set('Authorization', `Bearer ${tokenC}`);

      expect(res.status).toBe(200);
      expect(res.body.data.conversations.length).toBe(0);
      expect(res.body.data.total).toBe(0);
    });
  });

  describe('POST /api/v1/conversations/:id/messages — Send Message', () => {
    it('User A sends text message in active conversation (201)', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${activeConversationId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Hey Bob, did you get the transfer?' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe('Hey Bob, did you get the transfer?');
      expect(res.body.data.isOutgoing).toBe(true);
      expect(res.body.data.senderId).toBe(userA.id);
    });

    it('User B sends text message with embedded transaction card (201)', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${activeConversationId}/messages`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          content: 'Yes! Here is the transaction receipt reference.',
          transactionId: sampleTransactionId
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe('Yes! Here is the transaction receipt reference.');
      expect(res.body.data.transaction).toBeDefined();
      expect(res.body.data.transaction.id).toBe(sampleTransactionId);
    });

    it('rejects empty message content (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${activeConversationId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects message exceeding 2000 characters (400)', async () => {
      const longText = 'A'.repeat(2005);
      const res = await request(app)
        .post(`/api/v1/conversations/${activeConversationId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: longText });

      expect(res.status).toBe(400);
    });

    it('rejects invalid or non-existent transactionId (400)', async () => {
      const fakeTxId = crypto.randomUUID();
      const res = await request(app)
        .post(`/api/v1/conversations/${activeConversationId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Look at this fake transaction', transactionId: fakeTxId });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TRANSACTION_ID');
    });
  });

  describe('GET /api/v1/conversations/:id/messages — Fetch Messages', () => {
    it('User B fetches conversation messages in chronological order (200)', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${activeConversationId}/messages`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messages).toBeInstanceOf(Array);
      expect(res.body.data.messages.length).toBeGreaterThanOrEqual(2);

      // Verify embedded card is returned
      const msgWithTx = res.body.data.messages.find(m => m.transaction && m.transaction.id === sampleTransactionId);
      expect(msgWithTx).toBeDefined();
      expect(msgWithTx.transaction.amount).toBe(25.00);
    });

    it('paginates message history correctly with page and limit parameters', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${activeConversationId}/messages?page=1&limit=1`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.messages.length).toBe(1);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.limit).toBe(1);
      expect(res.body.data.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Security & Authorization Boundary (RLS & Cross-User Isolation)', () => {
    it('User C (unauthorized third-party) is FORBIDDEN from viewing messages (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${activeConversationId}/messages`)
        .set('Authorization', `Bearer ${tokenC}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CHAT_FORBIDDEN');
    });

    it('User C (unauthorized third-party) is FORBIDDEN from sending messages into conversation (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${activeConversationId}/messages`)
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ content: 'I am an eavesdropper trying to intrude!' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CHAT_FORBIDDEN');
    });

    it('direct Supabase client query with User C JWT returns ZERO messages due to Postgres RLS', async () => {
      const anonKey = getAnonKey();
      if (!anonKey) {
        console.warn('Skipping direct RLS test: SUPABASE_ANON_KEY or SUPABASE_JWT_SECRET not available');
        return;
      }

      const userCClient = createClient(env.SUPABASE_URL, anonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${tokenC}` } }
      });

      const { data, error } = await userCClient
        .from('messages')
        .select('*')
        .eq('conversation_id', activeConversationId);

      expect(error).toBeNull();
      // Postgres RLS messages_select_own must filter out all rows
      expect(data).toHaveLength(0);
    });
  });
});
