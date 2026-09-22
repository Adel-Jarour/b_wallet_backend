const request = require('supertest');
const crypto = require('crypto');
const app = require('../../src/app');
const { supabaseAdmin } = require('../../src/config/supabase');
const PinService = require('../../src/services/pin.service');
const NotificationService = require('../../src/services/notification.service');
const { pushProvider } = require('../../src/config/firebase');
const { createClient } = require('@supabase/supabase-js');
const { env } = require('../../src/config/env');

/**
 * Derives the Supabase anon key from the service role key.
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

describe('Integration: Notification Engine & Alert Dispatcher (/api/v1/notifications)', () => {
  const testUsersToCleanup = [];
  const testTxIdsToCleanup = [];
  const testRequestIdsToCleanup = [];

  let senderUser, senderToken;
  let receiverUser, receiverToken;
  let thirdPartyUser, thirdPartyToken;

  const senderEmail = `notif_sender_${Date.now()}@bwallet.dev`;
  const receiverEmail = `notif_rec_${Date.now()}@bwallet.dev`;
  const thirdPartyEmail = `notif_third_${Date.now()}@bwallet.dev`;
  const password = 'Password123!';
  const validPin = '123456';

  beforeAll(async () => {
    // 1. Register and setup Sender
    const resSender = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: senderEmail, password, firstName: 'Sender', lastName: 'User' });
    expect(resSender.status).toBe(201);
    senderUser = resSender.body.data.user;
    testUsersToCleanup.push(senderUser.id);

    const loginSender = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: senderEmail, password });
    senderToken = loginSender.body.data.accessToken;
    await PinService.setupPin(senderUser.id, validPin);

    // Fund sender wallet with $500 for testing
    await supabaseAdmin
      .from('wallets')
      .update({ balance: 500.00 })
      .eq('user_id', senderUser.id);

    // 2. Register and setup Receiver
    const resRec = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: receiverEmail, password, firstName: 'Receiver', lastName: 'User' });
    expect(resRec.status).toBe(201);
    receiverUser = resRec.body.data.user;
    testUsersToCleanup.push(receiverUser.id);

    const loginRec = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: receiverEmail, password });
    receiverToken = loginRec.body.data.accessToken;
    await PinService.setupPin(receiverUser.id, validPin);

    // Fund receiver wallet with $100 for testing
    await supabaseAdmin
      .from('wallets')
      .update({ balance: 100.00 })
      .eq('user_id', receiverUser.id);

    // 3. Register Third-Party
    const resThird = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: thirdPartyEmail, password, firstName: 'Third', lastName: 'Party' });
    expect(resThird.status).toBe(201);
    thirdPartyUser = resThird.body.data.user;
    testUsersToCleanup.push(thirdPartyUser.id);

    const loginThird = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: thirdPartyEmail, password });
    thirdPartyToken = loginThird.body.data.accessToken;
  });

  afterAll(async () => {
    // Delete payment requests
    if (testRequestIdsToCleanup.length > 0) {
      await supabaseAdmin.from('payment_requests').delete().in('id', testRequestIdsToCleanup);
    }
    // Delete notifications
    if (testUsersToCleanup.length > 0) {
      await supabaseAdmin.from('notifications').delete().in('user_id', testUsersToCleanup);
      await supabaseAdmin.from('device_tokens').delete().in('user_id', testUsersToCleanup);
    }
    // Delete transactions & ledger
    if (testTxIdsToCleanup.length > 0) {
      await supabaseAdmin.from('ledger_entries').delete().in('transaction_id', testTxIdsToCleanup);
      await supabaseAdmin.from('transactions').delete().in('id', testTxIdsToCleanup);
    }
    // Delete test users
    for (const uid of testUsersToCleanup) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(uid);
      } catch (e) {
        // ignore
      }
    }
  });

  describe('POST /api/v1/users/device-token — FCM Push Token Registration', () => {
    it('successfully registers an FCM device token for the user (200)', async () => {
      const sampleToken = 'fcm_token_' + crypto.randomBytes(8).toString('hex');

      const res = await request(app)
        .post('/api/v1/users/device-token')
        .set('Authorization', `Bearer ${receiverToken}`)
        .send({ token: sampleToken, platform: 'android' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBe(sampleToken);
      expect(res.body.data.platform).toBe('android');
    });

    it('rejects invalid or empty token (400)', async () => {
      const res = await request(app)
        .post('/api/v1/users/device-token')
        .set('Authorization', `Bearer ${receiverToken}`)
        .send({ token: '   ' });

      expect(res.status).toBe(400);
    });

    it('rejects unauthenticated token registration (401)', async () => {
      const res = await request(app)
        .post('/api/v1/users/device-token')
        .send({ token: 'test_token_123' });

      expect(res.status).toBe(401);
    });
  });

  describe('In-App Notification Center Endpoints (/api/v1/notifications)', () => {
    let createdNotificationId;

    beforeAll(async () => {
      // Seed two test notifications for Receiver
      const n1 = await NotificationService.createNotification({
        userId: receiverUser.id,
        category: 'TRANSACTIONS',
        title: 'Test Inflow',
        body: 'You received $20.00',
        metadata: { amount: 20 }
      });
      createdNotificationId = n1.id;

      await NotificationService.createNotification({
        userId: receiverUser.id,
        category: 'PROMOS',
        title: 'Special Promo',
        body: 'Earn 5% cashback this weekend!',
        metadata: { promoCode: 'WEEKEND5' }
      });
    });

    it('lists all notifications for the authenticated user with unread count (200)', async () => {
      const res = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${receiverToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.notifications).toBeInstanceOf(Array);
      expect(res.body.data.notifications.length).toBeGreaterThanOrEqual(2);
      expect(res.body.data.unreadCount).toBeGreaterThanOrEqual(2);
    });

    it('filters notifications by category TRANSACTIONS (200)', async () => {
      const res = await request(app)
        .get('/api/v1/notifications?category=TRANSACTIONS')
        .set('Authorization', `Bearer ${receiverToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.notifications.every(n => n.category === 'TRANSACTIONS')).toBe(true);
    });

    it('filters notifications by is_read status (200)', async () => {
      const res = await request(app)
        .get('/api/v1/notifications?is_read=false')
        .set('Authorization', `Bearer ${receiverToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.notifications.every(n => n.is_read === false)).toBe(true);
    });

    it('marks a single notification as read (200)', async () => {
      const res = await request(app)
        .patch(`/api/v1/notifications/${createdNotificationId}/read`)
        .set('Authorization', `Bearer ${receiverToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.is_read).toBe(true);
    });

    it('marks all notifications as read for user (200)', async () => {
      const res = await request(app)
        .post('/api/v1/notifications/read-all')
        .set('Authorization', `Bearer ${receiverToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.updatedCount).toBeGreaterThanOrEqual(1);

      // Verify unread count is now 0
      const check = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${receiverToken}`);

      expect(check.body.data.unreadCount).toBe(0);
    });

    it('cross-user isolation: User C cannot mark User B notification as read (403/404)', async () => {
      const res = await request(app)
        .patch(`/api/v1/notifications/${createdNotificationId}/read`)
        .set('Authorization', `Bearer ${thirdPartyToken}`);

      expect([403, 404]).toContain(res.status);
    });

    it('direct Supabase client query with User C JWT returns ZERO of User B notifications due to RLS', async () => {
      const anonKey = getAnonKey();
      if (!anonKey) {
        console.warn('Skipping direct RLS test: SUPABASE_ANON_KEY or SUPABASE_JWT_SECRET not available');
        return;
      }

      const userCClient = createClient(env.SUPABASE_URL, anonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${thirdPartyToken}` } }
      });

      const { data, error } = await userCClient
        .from('notifications')
        .select('*')
        .eq('user_id', receiverUser.id);

      expect(error).toBeNull();
      // Postgres RLS notifications_select_own must filter out all rows
      expect(data).toHaveLength(0);
    });
  });

  describe('Transaction-Generated Notifications Flow', () => {
    it('executing transfer automatically triggers notification creation for receiver', async () => {
      const idempotencyKey = crypto.randomUUID();

      const transferRes = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idempotencyKey)
        .send({
          receiverId: receiverUser.id,
          amount: 15.00,
          category: 'Food',
          note: 'Dinner split',
          pin: validPin
        });

      expect(transferRes.status).toBe(201);
      const receipt = transferRes.body.data.receipt;
      testTxIdsToCleanup.push(receipt.transactionId);

      // Verify notification was created for receiver
      const notifRes = await request(app)
        .get('/api/v1/notifications?category=TRANSACTIONS')
        .set('Authorization', `Bearer ${receiverToken}`);

      expect(notifRes.status).toBe(200);
      const transferNotif = notifRes.body.data.notifications.find(
        n => n.metadata && n.metadata.transactionId === receipt.transactionId
      );

      expect(transferNotif).toBeDefined();
      expect(transferNotif.title).toBe('Funds Received');
      expect(transferNotif.body).toMatch(/15\.00/);
    });

    it('failed transfer (incorrect PIN) does NOT generate any notification for receiver', async () => {
      const idempotencyKey = crypto.randomUUID();

      // Attempt transfer with wrong PIN
      const failRes = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idempotencyKey)
        .send({
          receiverId: receiverUser.id,
          amount: 25.00,
          category: 'Food',
          note: 'Failed transfer',
          pin: '999999' // Wrong PIN
        });

      expect(failRes.status).toBe(400);

      // Verify no notification with amount 25.00 was created
      const notifRes = await request(app)
        .get('/api/v1/notifications?category=TRANSACTIONS')
        .set('Authorization', `Bearer ${receiverToken}`);

      const phantomNotif = notifRes.body.data.notifications.find(
        n => n.metadata && n.metadata.amount === 25.00
      );
      expect(phantomNotif).toBeUndefined();
    });

    it('payment request lifecycle generates corresponding notifications for parties', async () => {
      // 1. Receiver creates payment request to Sender
      const createReqRes = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${receiverToken}`)
        .send({
          payerId: senderUser.id,
          amount: 30.00,
          category: 'Expense',
          note: 'Electric bill share'
        });

      expect(createReqRes.status).toBe(201);
      const reqId = createReqRes.body.data.request ? createReqRes.body.data.request.id : createReqRes.body.data.id;
      testRequestIdsToCleanup.push(reqId);

      // Payer (Sender) should receive "Payment Request Received" notification
      const payerNotifs = await request(app)
        .get('/api/v1/notifications?category=TRANSACTIONS')
        .set('Authorization', `Bearer ${senderToken}`);

      const reqNotif = payerNotifs.body.data.notifications.find(
        n => n.metadata && n.metadata.requestId === reqId
      );
      expect(reqNotif).toBeDefined();
      expect(reqNotif.title).toBe('Payment Request Received');

      // 2. Sender settles the payment request
      const payRes = await request(app)
        .post(`/api/v1/requests/${reqId}/pay`)
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', crypto.randomUUID())
        .send({ pin: validPin });

      expect(payRes.status).toBe(200);
      if (payRes.body.data?.receipt?.transactionId) {
        testTxIdsToCleanup.push(payRes.body.data.receipt.transactionId);
      }

      // Requester (Receiver) should receive "Payment Request Paid" notification
      const requesterNotifs = await request(app)
        .get('/api/v1/notifications?category=TRANSACTIONS')
        .set('Authorization', `Bearer ${receiverToken}`);

      const paidNotif = requesterNotifs.body.data.notifications.find(
        n => n.metadata && n.metadata.requestId === reqId && n.metadata.type === 'PAYMENT_REQUEST_PAID'
      );
      expect(paidNotif).toBeDefined();
      expect(paidNotif.title).toBe('Payment Request Paid');
    });
  });

  describe('Critical Financial Integration Rule: Non-Blocking Fault Isolation', () => {
    it('a transfer remains completely successful even if notification dispatch throws an error', async () => {
      // Spy and force NotificationService.notifyTransferReceived to throw
      const notifySpy = jest
        .spyOn(NotificationService, 'notifyTransferReceived')
        .mockImplementationOnce(() => {
          throw new Error('FCM/Notification cluster outage simulation');
        });

      const idempotencyKey = crypto.randomUUID();

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${senderToken}`)
        .set('X-Idempotency-Key', idempotencyKey)
        .send({
          receiverId: receiverUser.id,
          amount: 10.00,
          category: 'Food',
          note: 'Resilience test transfer',
          pin: validPin
        });

      // Transfer MUST NOT fail because notification failed!
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.receipt).toBeDefined();
      expect(res.body.data.receipt.amount).toBe('10.00');

      testTxIdsToCleanup.push(res.body.data.receipt.transactionId);

      // Verify spy was called
      expect(notifySpy).toHaveBeenCalled();
      notifySpy.mockRestore();
    });
  });
});
