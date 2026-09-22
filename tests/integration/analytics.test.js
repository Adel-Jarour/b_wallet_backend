/**
 * Integration Tests: Cash Flow Analytics & Financial Intelligence
 * ================================================================
 * Validates:
 *   - Mathematical precision of Total Income, Total Expense, Net Savings, and Net Savings Ratio
 *   - Categorized expense distributions with exact percentage allocations
 *   - Interval granularity (weekly, monthly, yearly)
 *   - Zero-filled continuous time-series chart data for Syncfusion Flutter charts
 *   - Empty period handling (zero division safety, no NaN, 0.00 defaults)
 *   - User isolation and strict authorization enforcement
 *   - Date range validation (format, chronological order, 5-year max window)
 */

const request = require('supertest');
const app = require('../../src/app');
const { supabaseAdmin } = require('../../src/config/supabase');

jest.setTimeout(60000);

describe('Integration: Cash Flow Analytics (/api/v1/analytics/cash-flow)', () => {
  const testUsersToCleanup = [];
  const testTxIdsToCleanup = [];

  let userA, tokenA;
  let userB, tokenB;
  let userEmpty, tokenEmpty;

  const emailA = `analytics_a_${Date.now()}@bwallet.dev`;
  const emailB = `analytics_b_${Date.now()}@bwallet.dev`;
  const emailEmpty = `analytics_empty_${Date.now()}@bwallet.dev`;
  const password = 'Password123!';

  beforeAll(async () => {
    // 1. Register User A (Active transactor)
    const resA = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: emailA, password, firstName: 'Alice', lastName: 'Analytics' });
    expect(resA.status).toBe(201);
    userA = resA.body.data.user;
    testUsersToCleanup.push(userA.id);

    const loginA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailA, password });
    expect(loginA.status).toBe(200);
    tokenA = loginA.body.data.accessToken;

    // 2. Register User B (Counterparty)
    const resB = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: emailB, password, firstName: 'Bob', lastName: 'Counterparty' });
    expect(resB.status).toBe(201);
    userB = resB.body.data.user;
    testUsersToCleanup.push(userB.id);

    const loginB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailB, password });
    expect(loginB.status).toBe(200);
    tokenB = loginB.body.data.accessToken;

    // 3. Register User Empty (Zero transactions)
    const resEmpty = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: emailEmpty, password, firstName: 'Eve', lastName: 'Empty' });
    expect(resEmpty.status).toBe(201);
    userEmpty = resEmpty.body.data.user;
    testUsersToCleanup.push(userEmpty.id);

    const loginEmpty = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailEmpty, password });
    expect(loginEmpty.status).toBe(200);
    tokenEmpty = loginEmpty.body.data.accessToken;

    // 4. Seed 5 completed transactions for User A within the current month
    // Tx 1: Top-Up $500.00 (Income)
    const tx1Res = await supabaseAdmin.from('transactions').insert({
      transaction_reference: `TXN-ANA-01-${Date.now()}`,
      sender_id: null,
      receiver_id: userA.id,
      amount: 500.00,
      fee: 0.00,
      currency: 'USD',
      type: 'TOP_UP',
      status: 'COMPLETED',
      category: 'TopUp',
      created_at: new Date().toISOString()
    }).select().single();
    testTxIdsToCleanup.push(tx1Res.data.id);

    // Tx 2: Inbound P2P Transfer from Bob $200.00 (Income)
    const tx2Res = await supabaseAdmin.from('transactions').insert({
      transaction_reference: `TXN-ANA-02-${Date.now()}`,
      sender_id: userB.id,
      receiver_id: userA.id,
      amount: 200.00,
      fee: 0.00,
      currency: 'USD',
      type: 'TRANSFER',
      status: 'COMPLETED',
      category: 'Food',
      created_at: new Date().toISOString()
    }).select().single();
    testTxIdsToCleanup.push(tx2Res.data.id);

    // Tx 3: Outbound P2P to Bob $100.00 + $2.00 fee (Expense: Food)
    const tx3Res = await supabaseAdmin.from('transactions').insert({
      transaction_reference: `TXN-ANA-03-${Date.now()}`,
      sender_id: userA.id,
      receiver_id: userB.id,
      amount: 100.00,
      fee: 2.00,
      currency: 'USD',
      type: 'TRANSFER',
      status: 'COMPLETED',
      category: 'Food',
      created_at: new Date().toISOString()
    }).select().single();
    testTxIdsToCleanup.push(tx3Res.data.id);

    // Tx 4: Outbound P2P to Bob $150.00 (Expense: Entertainment)
    const tx4Res = await supabaseAdmin.from('transactions').insert({
      transaction_reference: `TXN-ANA-04-${Date.now()}`,
      sender_id: userA.id,
      receiver_id: userB.id,
      amount: 150.00,
      fee: 0.00,
      currency: 'USD',
      type: 'TRANSFER',
      status: 'COMPLETED',
      category: 'Entertainment',
      created_at: new Date().toISOString()
    }).select().single();
    testTxIdsToCleanup.push(tx4Res.data.id);

    // Tx 5: Outbound P2P to Bob $50.00 (Expense: Hobby)
    const tx5Res = await supabaseAdmin.from('transactions').insert({
      transaction_reference: `TXN-ANA-05-${Date.now()}`,
      sender_id: userA.id,
      receiver_id: userB.id,
      amount: 50.00,
      fee: 0.00,
      currency: 'USD',
      type: 'TRANSFER',
      status: 'COMPLETED',
      category: 'Hobby',
      created_at: new Date().toISOString()
    }).select().single();
    testTxIdsToCleanup.push(tx5Res.data.id);
  });

  afterAll(async () => {
    if (testTxIdsToCleanup.length > 0) {
      await supabaseAdmin.from('transactions').delete().in('id', testTxIdsToCleanup);
    }
    for (const id of testUsersToCleanup) {
      await supabaseAdmin.auth.admin.deleteUser(id);
    }
  });

  describe('1. Mathematical Accuracy & Summary Metrics (FR-ANA-001, FR-ANA-002)', () => {
    test('Calculates exact Total Income, Total Expense, Net Savings, and Savings Ratio', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/cash-flow?period=monthly&currency=USD')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const { summary } = res.body.data;

      // Inflow: 500.00 (TopUp) + 200.00 (Transfer) = 700.00
      expect(summary.total_income).toBe(700.00);

      // Outflow: (100.00 + 2.00 fee) + 150.00 + 50.00 = 302.00
      expect(summary.total_expense).toBe(302.00);

      // Net Savings: 700.00 - 302.00 = 398.00
      expect(summary.net_savings).toBe(398.00);

      // Savings Ratio: (398.00 / 700.00) * 100 = 56.86%
      expect(summary.net_savings_ratio).toBe(56.86);
    });
  });

  describe('2. Category Breakdown & Percentage Allocation (FR-ANA-003)', () => {
    test('Calculates category allocations and ensures percentages sum to 100%', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/cash-flow?period=monthly&currency=USD')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const { categories } = res.body.data;

      expect(categories).toBeDefined();
      expect(categories).toHaveLength(3);

      const entertainment = categories.find(c => c.category === 'Entertainment');
      const food = categories.find(c => c.category === 'Food');
      const hobby = categories.find(c => c.category === 'Hobby');

      expect(entertainment).toBeDefined();
      expect(entertainment.total_amount).toBe(150.00);
      expect(entertainment.percentage).toBe(49.67);
      expect(entertainment.transaction_count).toBe(1);

      expect(food).toBeDefined();
      expect(food.total_amount).toBe(102.00); // 100 + 2 fee
      expect(food.percentage).toBe(33.77);
      expect(food.transaction_count).toBe(1);

      expect(hobby).toBeDefined();
      expect(hobby.total_amount).toBe(50.00);
      expect(hobby.percentage).toBe(16.56);
      expect(hobby.transaction_count).toBe(1);

      // Sum of percentages must equal 100.00% (within rounding margin)
      const totalPercentage = parseFloat(
        categories.reduce((sum, c) => sum + c.percentage, 0).toFixed(2)
      );
      expect(Math.abs(totalPercentage - 100.00)).toBeLessThanOrEqual(0.01);
    });
  });

  describe('3. Periodic Time-Series & Syncfusion Chart Data', () => {
    test('period=weekly returns 7 continuous daily buckets', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/cash-flow?period=weekly')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.chart_data).toHaveLength(7);
      res.body.data.chart_data.forEach(bucket => {
        expect(bucket.label).toBeDefined();
        expect(bucket.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(typeof bucket.income).toBe('number');
        expect(typeof bucket.expense).toBe('number');
        expect(typeof bucket.net).toBe('number');
      });
    });

    test('period=monthly returns 4-5 weekly buckets', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/cash-flow?period=monthly')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.chart_data.length).toBeGreaterThanOrEqual(4);
      expect(res.body.data.chart_data.length).toBeLessThanOrEqual(5);
      expect(res.body.data.chart_data[0].label).toBe('Week 1');
    });

    test('period=yearly returns exactly 12 monthly buckets', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/cash-flow?period=yearly')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.chart_data).toHaveLength(12);
      expect(res.body.data.chart_data[0].label).toBe('Jan');
      expect(res.body.data.chart_data[11].label).toBe('Dec');
    });
  });

  describe('4. Empty Period Handling & Zero Division Safety', () => {
    test('User with zero transactions returns 0.00 summary, empty categories, and zero-filled chart buckets', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/cash-flow?period=monthly')
        .set('Authorization', `Bearer ${tokenEmpty}`);

      expect(res.status).toBe(200);
      const { summary, categories, chart_data } = res.body.data;

      expect(summary.total_income).toBe(0.00);
      expect(summary.total_expense).toBe(0.00);
      expect(summary.net_savings).toBe(0.00);
      expect(summary.net_savings_ratio).toBe(0.00);
      expect(Number.isNaN(summary.net_savings_ratio)).toBe(false);

      expect(categories).toEqual([]);
      expect(chart_data.length).toBeGreaterThanOrEqual(4);
      chart_data.forEach(bucket => {
        expect(bucket.income).toBe(0.00);
        expect(bucket.expense).toBe(0.00);
        expect(bucket.net).toBe(0.00);
      });
    });
  });

  describe('5. User Ownership & Data Isolation', () => {
    test('User B only sees transactions where they are sender or receiver, isolated from User A totals', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/cash-flow?period=monthly')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      const { summary } = res.body.data;

      // User B sent Tx2 ($200.00) and received Tx3, Tx4, Tx5 ($100, $150, $50 = $300.00)
      expect(summary.total_income).toBe(300.00);
      expect(summary.total_expense).toBe(200.00);
      expect(summary.net_savings).toBe(100.00);
      expect(summary.net_savings_ratio).toBe(33.33);
    });
  });

  describe('6. Validation & Security Controls', () => {
    test('Rejects invalid period value with 400', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/cash-flow?period=daily')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('Rejects invalid start_date format with 400', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/cash-flow?start_date=not-a-date')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('Rejects start_date after end_date with 400', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/cash-flow?start_date=2026-10-01&end_date=2026-09-01')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('Rejects query window exceeding 5 years with 400', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/cash-flow?start_date=2020-01-01&end_date=2026-09-01')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/5 years/i);
    });

    test('Rejects unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/analytics/cash-flow');
      expect(res.status).toBe(401);
    });
  });
});
