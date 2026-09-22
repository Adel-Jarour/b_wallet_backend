/**
 * Integration Tests: Cards Management & PCI-DSS Compliance
 * ========================================================
 * Validates:
 *   - Tokenized card storage (PCI-DSS SAQ-A compliant)
 *   - Strict rejection of raw PAN, CVC, and CVV payloads
 *   - Listing user saved cards (ordered by default first)
 *   - Setting default card (and unsetting previous defaults)
 *   - Deleting saved card (and reassigning default if necessary)
 *   - Cross-user isolation (User A cannot see/modify User B's cards)
 *   - Validation rules (last4, brand, future expiry)
 */

const request = require('supertest');
const app = require('../../src/app');
const { supabaseAdmin } = require('../../src/config/supabase');

jest.setTimeout(60000);

describe('Integration: Cards & PCI-DSS Tokenization (/api/v1/cards)', () => {
  const testUsersToCleanup = [];
  const testCardIdsToCleanup = [];

  let userA, tokenA;
  let userB, tokenB;

  const emailA = `card_test_a_${Date.now()}@bwallet.dev`;
  const emailB = `card_test_b_${Date.now()}@bwallet.dev`;
  const password = 'Password123!';

  beforeAll(async () => {
    // 1. Register User A
    const resA = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: emailA, password, firstName: 'CardUser', lastName: 'A' });
    expect(resA.status).toBe(201);
    userA = resA.body.data.user;
    testUsersToCleanup.push(userA.id);

    const loginA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailA, password });
    expect(loginA.status).toBe(200);
    tokenA = loginA.body.data.accessToken;

    // 2. Register User B
    const resB = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: emailB, password, firstName: 'CardUser', lastName: 'B' });
    expect(resB.status).toBe(201);
    userB = resB.body.data.user;
    testUsersToCleanup.push(userB.id);

    const loginB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailB, password });
    expect(loginB.status).toBe(200);
    tokenB = loginB.body.data.accessToken;
  });

  afterAll(async () => {
    // Clean up cards
    if (testCardIdsToCleanup.length > 0) {
      await supabaseAdmin.from('saved_cards').delete().in('id', testCardIdsToCleanup);
    }
    // Clean up users
    for (const id of testUsersToCleanup) {
      await supabaseAdmin.auth.admin.deleteUser(id);
    }
  });

  describe('1. PCI-DSS Zero Raw Card Data Enforcement', () => {
    test('TC-CARD-SEC-01: Rejects payload with raw card_number (PAN)', async () => {
      const res = await request(app)
        .post('/api/v1/cards')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          card_number: '4111111111114242',
          brand: 'Visa',
          last4: '4242',
          expiry_month: 12,
          expiry_year: 2028
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PCI_DSS_VIOLATION');
      expect(res.body.error.message).toMatch(/strictly prohibited/i);
    });

    test('TC-CARD-SEC-02: Rejects payload with raw cvc / cvv', async () => {
      const res = await request(app)
        .post('/api/v1/cards')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          gateway_payment_method_id: 'pm_tok_test_123',
          cvc: '123',
          brand: 'Visa',
          last4: '4242',
          expiry_month: 12,
          expiry_year: 2028
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PCI_DSS_VIOLATION');
    });

    test('TC-CARD-SEC-03: Rejects payload with raw pan field', async () => {
      const res = await request(app)
        .post('/api/v1/cards')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          pan: '4242424242424242',
          brand: 'Visa',
          last4: '4242',
          expiry_month: 12,
          expiry_year: 2028
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PCI_DSS_VIOLATION');
    });
  });

  describe('2. Card Validation Rules', () => {
    test('Rejects invalid last4 (letters or not 4 digits)', async () => {
      const res = await request(app)
        .post('/api/v1/cards')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          gateway_payment_method_id: 'pm_tok_val_1',
          brand: 'Visa',
          last4: '12a4',
          expiry_month: 12,
          expiry_year: 2028
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('Rejects invalid brand not in allowed list', async () => {
      const res = await request(app)
        .post('/api/v1/cards')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          gateway_payment_method_id: 'pm_tok_val_2',
          brand: 'InvalidBrand',
          last4: '1234',
          expiry_month: 12,
          expiry_year: 2028
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('Rejects past expiry year', async () => {
      const res = await request(app)
        .post('/api/v1/cards')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          gateway_payment_method_id: 'pm_tok_val_3',
          brand: 'Visa',
          last4: '1234',
          expiry_month: 12,
          expiry_year: 2020
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('3. Card Lifecycle (Save, List, Default, Delete)', () => {
    let card1Id, card2Id;

    test('POST /api/v1/cards: Successfully saves tokenized card (auto-default first card)', async () => {
      const res = await request(app)
        .post('/api/v1/cards')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          gateway_payment_method_id: 'pm_card_visa_tok_001',
          brand: 'Visa',
          last4: '4242',
          expiry_month: 10,
          expiry_year: 2028
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.card).toBeDefined();
      expect(res.body.data.card.brand).toBe('Visa');
      expect(res.body.data.card.last4).toBe('4242');
      expect(res.body.data.card.expiry_month).toBe(10);
      expect(res.body.data.card.expiry_year).toBe(2028);
      // First card automatically becomes default
      expect(res.body.data.card.is_default).toBe(true);

      card1Id = res.body.data.card.id;
      testCardIdsToCleanup.push(card1Id);
    });

    test('POST /api/v1/cards: Saves second card without making it default by default', async () => {
      const res = await request(app)
        .post('/api/v1/cards')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          gateway_payment_method_id: 'pm_card_mc_tok_002',
          brand: 'MasterCard',
          last4: '5555',
          expiry_month: 11,
          expiry_year: 2029,
          is_default: false
        });

      expect(res.status).toBe(201);
      expect(res.body.data.card.brand).toBe('MasterCard');
      expect(res.body.data.card.last4).toBe('5555');
      expect(res.body.data.card.is_default).toBe(false);

      card2Id = res.body.data.card.id;
      testCardIdsToCleanup.push(card2Id);
    });

    test('GET /api/v1/cards: Lists saved cards for User A with default first', async () => {
      const res = await request(app)
        .get('/api/v1/cards')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.cards).toHaveLength(2);
      expect(res.body.data.cards[0].id).toBe(card1Id);
      expect(res.body.data.cards[0].is_default).toBe(true);
      expect(res.body.data.cards[1].id).toBe(card2Id);
      expect(res.body.data.cards[1].is_default).toBe(false);
    });

    test('PATCH /api/v1/cards/:id/default: Switches default payment card to second card', async () => {
      const res = await request(app)
        .patch(`/api/v1/cards/${card2Id}/default`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.card.id).toBe(card2Id);
      expect(res.body.data.card.is_default).toBe(true);

      // Verify card 1 is no longer default
      const listRes = await request(app)
        .get('/api/v1/cards')
        .set('Authorization', `Bearer ${tokenA}`);

      const card1 = listRes.body.data.cards.find(c => c.id === card1Id);
      const card2 = listRes.body.data.cards.find(c => c.id === card2Id);
      expect(card1.is_default).toBe(false);
      expect(card2.is_default).toBe(true);
    });

    test('DELETE /api/v1/cards/:id: Successfully removes card', async () => {
      const res = await request(app)
        .delete(`/api/v1/cards/${card2Id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Remaining card 1 should now be restored as default
      const listRes = await request(app)
        .get('/api/v1/cards')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(listRes.body.data.cards).toHaveLength(1);
      expect(listRes.body.data.cards[0].id).toBe(card1Id);
      expect(listRes.body.data.cards[0].is_default).toBe(true);
    });
  });

  describe('4. Cross-User Authorization & Isolation', () => {
    let userBCardId;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/cards')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          gateway_payment_method_id: 'pm_card_b_tok_999',
          brand: 'Amex',
          last4: '0005',
          expiry_month: 6,
          expiry_year: 2027
        });
      userBCardId = res.body.data.card.id;
      testCardIdsToCleanup.push(userBCardId);
    });

    test('User A cannot view User B saved cards via GET /cards', async () => {
      const res = await request(app)
        .get('/api/v1/cards')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const cardIds = res.body.data.cards.map(c => c.id);
      expect(cardIds).not.toContain(userBCardId);
    });

    test('User A cannot set User B card as default (returns 404)', async () => {
      const res = await request(app)
        .patch(`/api/v1/cards/${userBCardId}/default`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CARD_NOT_FOUND');
    });

    test('User A cannot delete User B card (returns 404)', async () => {
      const res = await request(app)
        .delete(`/api/v1/cards/${userBCardId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CARD_NOT_FOUND');
    });
  });

  describe('5. Unauthenticated Access', () => {
    test('Rejects unauthenticated GET /api/v1/cards with 401', async () => {
      const res = await request(app).get('/api/v1/cards');
      expect(res.status).toBe(401);
    });

    test('Rejects unauthenticated POST /api/v1/cards with 401', async () => {
      const res = await request(app).post('/api/v1/cards').send({});
      expect(res.status).toBe(401);
    });
  });
});
