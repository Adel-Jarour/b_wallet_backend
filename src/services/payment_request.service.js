const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const { formatMoney } = require('../utils/money.util');
const PinService = require('./pin.service');
const NotificationService = require('./notification.service');
const { consumeTransactionTicket } = require('../utils/ticket.util');
const logger = require('../config/logger');

class PaymentRequestService {
  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Resolves the payer profile by phone, email, or UUID.
   * Returns only safe public fields — never exposes pin_hash.
   */
  static async resolvePayer(lookup) {
    let query = supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, phone_number, email');

    if (lookup.payerId) {
      query = query.eq('id', lookup.payerId);
    } else if (lookup.payerPhone) {
      query = query.eq('phone_number', lookup.payerPhone);
    } else if (lookup.payerEmail) {
      query = query.eq('email', lookup.payerEmail.toLowerCase());
    } else {
      throw ApiError.badRequest('Payer identifier is required', 'PAYER_MISSING');
    }

    const { data: profile, error } = await query.single();

    if (error || !profile) {
      throw ApiError.notFound(
        'Payer not found. Verify the phone number, email address, or user ID.',
        'PAYER_NOT_FOUND'
      );
    }

    return {
      id: profile.id,
      firstName: profile.first_name,
      lastName: profile.last_name
    };
  }

  /**
   * Generates a unique deterministic transaction reference for request settlements.
   * Format: REQ-YYYYMMDD-<8 random hex chars>
   */
  static generateRequestReference() {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `REQ-${date}-${random}`;
  }

  // ============================================================================
  // Create Payment Request
  // ============================================================================

  /**
   * Creates a new PENDING payment request from requester → payer.
   *
   * @param {string} requesterId - Authenticated user ID (from JWT)
   * @param {object} params
   * @returns {Promise<object>} Created payment request record
   */
  static async createRequest(requesterId, params) {
    const {
      payerPhone, payer_phone,
      payerEmail, payer_email,
      payerId, payer_id,
      amount,
      currency = 'USD',
      category,
      note
    } = params;

    // 1. Resolve payer
    const payer = await this.resolvePayer({
      payerPhone: payerPhone || payer_phone,
      payerEmail: payerEmail || payer_email,
      payerId: payerId || payer_id
    });

    // 2. Guard: no self-requests
    if (requesterId === payer.id) {
      throw ApiError.badRequest(
        'You cannot request money from yourself',
        'SELF_REQUEST_NOT_ALLOWED'
      );
    }

    // 3. Insert payment request (service_role bypasses RLS)
    const { data: request, error } = await supabaseAdmin
      .from('payment_requests')
      .insert({
        requester_id: requesterId,
        payer_id: payer.id,
        amount,
        currency,
        category: category || null,
        note: note || null,
        status: 'PENDING'
      })
      .select(`
        id,
        requester_id,
        payer_id,
        amount,
        currency,
        category,
        note,
        status,
        created_at,
        updated_at
      `)
      .single();

    if (error) {
      logger.error({ err: error.message, requesterId, payerId: payer.id }, 'Failed to create payment request');
      throw ApiError.internal('Failed to create payment request', 'REQUEST_CREATE_FAILED');
    }

    // Post-creation notification dispatch (non-blocking)
    try {
      await NotificationService.notifyPaymentRequestReceived({
        requesterId,
        payerId: payer.id,
        requestId: request.id,
        amount: request.amount,
        currency: request.currency,
        note: request.note
      });
    } catch (notifErr) {
      logger.error({ err: notifErr.message, requestId: request.id }, 'Failed to dispatch payment request notification (non-fatal)');
    }

    return {
      id: request.id,
      requesterId: request.requester_id,
      payerId: request.payer_id,
      payer: { id: payer.id, firstName: payer.firstName, lastName: payer.lastName },
      amount: formatMoney(request.amount),
      currency: request.currency,
      category: request.category,
      note: request.note,
      status: request.status,
      createdAt: request.created_at,
      updatedAt: request.updated_at
    };
  }

  // ============================================================================
  // List Requests
  // ============================================================================

  /**
   * Lists payment requests for the authenticated user.
   * Supports filtering by status and direction (sent/received/all).
   *
   * @param {string} userId - Authenticated user ID
   * @param {object} filters - { status, direction, page, limit }
   * @returns {Promise<{ requests: object[], total: number, page: number, limit: number }>}
   */
  static async listRequests(userId, filters) {
    const { status, direction = 'all', page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('payment_requests')
      .select(`
        id,
        requester_id,
        payer_id,
        amount,
        currency,
        category,
        note,
        status,
        transaction_id,
        created_at,
        updated_at,
        requester:profiles!payment_requests_requester_id_fkey(id, first_name, last_name),
        payer:profiles!payment_requests_payer_id_fkey(id, first_name, last_name)
      `, { count: 'exact' });

    // Direction filter
    if (direction === 'sent') {
      query = query.eq('requester_id', userId);
    } else if (direction === 'received') {
      query = query.eq('payer_id', userId);
    } else {
      // 'all': either party
      query = query.or(`requester_id.eq.${userId},payer_id.eq.${userId}`);
    }

    // Status filter
    if (status) {
      query = query.eq('status', status);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: requests, error, count } = await query;

    if (error) {
      logger.error({ err: error.message, userId }, 'Failed to list payment requests');
      throw ApiError.internal('Failed to retrieve payment requests', 'REQUEST_LIST_FAILED');
    }

    return {
      requests: (requests || []).map(r => this._formatRequest(r)),
      total: count || 0,
      page,
      limit
    };
  }

  // ============================================================================
  // Get Single Request
  // ============================================================================

  /**
   * Retrieves a single payment request by ID.
   * Only requester or payer may view it.
   *
   * @param {string} requestId - UUID of the payment request
   * @param {string} userId - Authenticated user ID
   * @returns {Promise<object>}
   */
  static async getRequestById(requestId, userId) {
    const { data: request, error } = await supabaseAdmin
      .from('payment_requests')
      .select(`
        id,
        requester_id,
        payer_id,
        amount,
        currency,
        category,
        note,
        status,
        transaction_id,
        created_at,
        updated_at,
        requester:profiles!payment_requests_requester_id_fkey(id, first_name, last_name),
        payer:profiles!payment_requests_payer_id_fkey(id, first_name, last_name)
      `)
      .eq('id', requestId)
      .single();

    if (error || !request) {
      throw ApiError.notFound(
        `Payment request ${requestId} not found`,
        'REQUEST_NOT_FOUND'
      );
    }

    // Authorization: only requester or payer may view
    if (request.requester_id !== userId && request.payer_id !== userId) {
      throw ApiError.forbidden(
        'You are not authorized to view this payment request',
        'REQUEST_ACCESS_DENIED'
      );
    }

    return this._formatRequest(request);
  }

  // ============================================================================
  // Pay (Settle) Request
  // ============================================================================

  /**
   * Settles a PENDING payment request.
   * Requires PIN or transaction ticket authorization.
   * Calls the settle_payment_request_atomic RPC.
   *
   * @param {string} requestId - UUID of the payment request
   * @param {string} payerId - Authenticated user ID (must be payer)
   * @param {{ pin?: string, transactionTicket?: string }} authData
   * @param {string} idempotencyKey - UUIDv4 from X-Idempotency-Key header
   * @returns {Promise<object>} Settlement receipt
   */
  static async payRequest(requestId, payerId, authData, idempotencyKey) {
    // 1. Fetch and validate the request
    const { data: request, error: fetchErr } = await supabaseAdmin
      .from('payment_requests')
      .select('id, requester_id, payer_id, amount, currency, status')
      .eq('id', requestId)
      .single();

    if (fetchErr || !request) {
      throw ApiError.notFound(`Payment request ${requestId} not found`, 'REQUEST_NOT_FOUND');
    }

    // 2. Authorization: only payer can pay
    if (request.payer_id !== payerId) {
      throw ApiError.forbidden(
        'You are not authorized to pay this request',
        'REQUEST_PAY_FORBIDDEN'
      );
    }

    // 3. Guard terminal states
    if (request.status !== 'PENDING') {
      throw ApiError.badRequest(
        `Payment request cannot be settled: current status is ${request.status}`,
        'REQUEST_NOT_PENDING'
      );
    }

    // 4. Authorize via PIN or transaction ticket
    await this._authorizeAction(authData, payerId, {
      transferParams: {
        amount: parseFloat(request.amount),
        receiverId: request.requester_id
      }
    });

    // 5. Generate unique transaction reference
    const txReference = this.generateRequestReference();

    // 6. Call atomic settlement RPC
    const { data: receiptData, error: rpcError } = await supabaseAdmin.rpc(
      'settle_payment_request_atomic',
      {
        p_request_id: requestId,
        p_payer_id: payerId,
        p_idempotency_key: idempotencyKey,
        p_tx_reference: txReference
      }
    );

    if (rpcError) {
      const msg = rpcError.message || '';

      if (msg.includes('Insufficient funds')) {
        throw ApiError.badRequest(
          'Insufficient funds: your wallet balance is too low to settle this request',
          'INSUFFICIENT_FUNDS'
        );
      }
      if (msg.includes('not PENDING')) {
        throw ApiError.badRequest(
          'Payment request cannot be settled: it is no longer pending',
          'REQUEST_NOT_PENDING'
        );
      }
      if (msg.includes('not the payer') || msg.includes('Authorization violation')) {
        throw ApiError.forbidden(
          'Authorization violation on request settlement',
          'REQUEST_PAY_FORBIDDEN'
        );
      }
      if (msg.includes('not ACTIVE')) {
        throw ApiError.badRequest(
          'Settlement failed: one or more wallets are not active',
          'WALLET_INACTIVE'
        );
      }
      if (msg.includes('not found')) {
        throw ApiError.notFound('Wallet not found for the specified currency', 'WALLET_NOT_FOUND');
      }

      logger.error({ err: msg, requestId, payerId }, 'settle_payment_request_atomic RPC error');
      throw ApiError.internal('Settlement failed. Please try again.', 'SETTLE_RPC_ERROR');
    }

    logger.info(
      { requestId, payerId, txRef: receiptData.transactionReference, amount: receiptData.amount },
      'Payment request settled successfully'
    );

    // Post-settlement notification dispatch (non-blocking)
    try {
      await NotificationService.notifyPaymentRequestSettled({
        payerId,
        requesterId: receiptData.requesterId,
        requestId: receiptData.requestId,
        transactionId: receiptData.transactionId,
        amount: receiptData.amount,
        currency: receiptData.currency
      });
    } catch (notifErr) {
      logger.error({ err: notifErr.message, requestId, txId: receiptData.transactionId }, 'Failed to dispatch settlement notification (non-fatal)');
    }

    return {
      requestId: receiptData.requestId,
      transactionId: receiptData.transactionId,
      transactionReference: receiptData.transactionReference,
      payer: { id: payerId },
      requester: { id: receiptData.requesterId },
      amount: formatMoney(receiptData.amount),
      currency: receiptData.currency,
      status: receiptData.status,
      category: receiptData.category,
      note: receiptData.note,
      payerBalanceAfter: formatMoney(receiptData.payerBalanceAfter),
      settledAt: receiptData.settledAt
    };
  }

  // ============================================================================
  // Decline Request
  // ============================================================================

  /**
   * Payer declines a PENDING payment request.
   *
   * @param {string} requestId - UUID of the payment request
   * @param {string} payerId - Authenticated user ID (must be payer)
   * @returns {Promise<object>} Updated request
   */
  static async declineRequest(requestId, payerId) {
    const { data: request, error: fetchErr } = await supabaseAdmin
      .from('payment_requests')
      .select('id, requester_id, payer_id, status')
      .eq('id', requestId)
      .single();

    if (fetchErr || !request) {
      throw ApiError.notFound(`Payment request ${requestId} not found`, 'REQUEST_NOT_FOUND');
    }

    if (request.payer_id !== payerId) {
      throw ApiError.forbidden(
        'Only the payer can decline a payment request',
        'REQUEST_DECLINE_FORBIDDEN'
      );
    }

    if (request.status !== 'PENDING') {
      throw ApiError.badRequest(
        `Payment request cannot be declined: current status is ${request.status}`,
        'REQUEST_NOT_PENDING'
      );
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('payment_requests')
      .update({ status: 'DECLINED', updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .select('id, requester_id, payer_id, amount, currency, category, note, status, updated_at')
      .single();

    if (updateErr) {
      logger.error({ err: updateErr.message, requestId }, 'Failed to decline payment request');
      throw ApiError.internal('Failed to decline payment request', 'REQUEST_DECLINE_FAILED');
    }

    // Post-decline notification dispatch (non-blocking)
    try {
      await NotificationService.notifyPaymentRequestDeclined({
        payerId,
        requesterId: updated.requester_id,
        requestId: updated.id,
        amount: updated.amount,
        currency: updated.currency
      });
    } catch (notifErr) {
      logger.error({ err: notifErr.message, requestId }, 'Failed to dispatch decline notification (non-fatal)');
    }

    return this._formatRequest(updated);
  }

  // ============================================================================
  // Cancel Request
  // ============================================================================

  /**
   * Requester cancels their own PENDING payment request.
   *
   * @param {string} requestId - UUID of the payment request
   * @param {string} requesterId - Authenticated user ID (must be requester)
   * @returns {Promise<object>} Updated request
   */
  static async cancelRequest(requestId, requesterId) {
    const { data: request, error: fetchErr } = await supabaseAdmin
      .from('payment_requests')
      .select('id, requester_id, payer_id, status')
      .eq('id', requestId)
      .single();

    if (fetchErr || !request) {
      throw ApiError.notFound(`Payment request ${requestId} not found`, 'REQUEST_NOT_FOUND');
    }

    if (request.requester_id !== requesterId) {
      throw ApiError.forbidden(
        'Only the requester can cancel a payment request',
        'REQUEST_CANCEL_FORBIDDEN'
      );
    }

    if (request.status !== 'PENDING') {
      throw ApiError.badRequest(
        `Payment request cannot be cancelled: current status is ${request.status}`,
        'REQUEST_NOT_PENDING'
      );
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('payment_requests')
      .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .select('id, requester_id, payer_id, amount, currency, category, note, status, updated_at')
      .single();

    if (updateErr) {
      logger.error({ err: updateErr.message, requestId }, 'Failed to cancel payment request');
      throw ApiError.internal('Failed to cancel payment request', 'REQUEST_CANCEL_FAILED');
    }

    return this._formatRequest(updated);
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Validates transfer authorization via PIN or transaction ticket.
   */
  static async _authorizeAction(authData, userId, context = {}) {
    const { pin, transactionTicket, transaction_ticket } = authData;
    const ticket = transactionTicket || transaction_ticket;

    if (pin) {
      await PinService.validateAndAuthorizePin(userId, pin);
      return;
    }
    if (ticket) {
      await consumeTransactionTicket(ticket, userId, context);
      return;
    }
    throw ApiError.unauthorized(
      'Transaction authorization required: provide pin or transactionTicket',
      'AUTH_REQUIRED'
    );
  }

  /**
   * Formats a raw DB payment_request row into a consistent API response shape.
   */
  static _formatRequest(r) {
    return {
      id: r.id,
      requesterId: r.requester_id,
      payerId: r.payer_id,
      requester: r.requester
        ? { id: r.requester_id, firstName: r.requester.first_name, lastName: r.requester.last_name }
        : { id: r.requester_id },
      payer: r.payer
        ? { id: r.payer_id, firstName: r.payer.first_name, lastName: r.payer.last_name }
        : { id: r.payer_id },
      amount: formatMoney(r.amount),
      currency: r.currency,
      category: r.category || null,
      note: r.note || null,
      status: r.status,
      transactionId: r.transaction_id || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }
}

module.exports = PaymentRequestService;
