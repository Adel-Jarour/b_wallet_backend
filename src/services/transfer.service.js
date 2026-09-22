const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const { consumeTransactionTicket, verifyTransactionTicket } = require('../utils/ticket.util');
const { formatMoney } = require('../utils/money.util');
const PinService = require('./pin.service');
const AmlService = require('./aml.service');
const NotificationService = require('./notification.service');
const logger = require('../config/logger');

// Platform default fee for standard P2P transfers (explicitly $0.00 unless configured)
const PLATFORM_FEE = 0.00;

class TransferService {
  /**
   * Looks up the receiver profile by phone number, email, or user ID.
   * Only returns minimal safe fields — never exposes pin_hash or sensitive data.
   *
   * @param {{ receiverPhone?: string, receiverEmail?: string, receiverId?: string }} lookup
   * @returns {Promise<{ id: string, firstName: string, lastName: string }>}
   */
  static async resolveReceiver(lookup) {
    let query = supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, phone_number, email');

    if (lookup.receiverId) {
      query = query.eq('id', lookup.receiverId);
    } else if (lookup.receiverPhone) {
      query = query.eq('phone_number', lookup.receiverPhone);
    } else if (lookup.receiverEmail) {
      query = query.eq('email', lookup.receiverEmail.toLowerCase());
    } else {
      throw ApiError.badRequest('Receiver identifier is required', 'RECEIVER_MISSING');
    }

    const { data: profile, error } = await query.single();

    if (error || !profile) {
      throw ApiError.notFound(
        'Recipient not found. Verify the phone number, email address, or user ID.',
        'RECEIVER_NOT_FOUND'
      );
    }

    return {
      id: profile.id,
      firstName: profile.first_name,
      lastName: profile.last_name
    };
  }

  /**
   * Validates transfer authorization.
   * Accepts either:
   *   1. Plaintext 6-digit PIN -> verified via PinService.validateAndAuthorizePin (Argon2id + lockout)
   *   2. Signed transaction ticket -> verified and consumed via consumeTransactionTicket (single-use enforcement)
   *
   * @param {{ pin?: string, transactionTicket?: string }} auth
   * @param {string} userId - Authenticated user ID (from JWT)
   * @param {object} [context] - Context options (e.g. transferParams for bound tickets)
   */
  static async authorizeTransfer(auth, userId, context = {}) {
    if (auth.pin) {
      // Validate PIN using PinService (with Argon2id, failed attempt counter, lockout)
      await PinService.validateAndAuthorizePin(userId, auth.pin);
      return;
    }

    const ticket = auth.transactionTicket;
    if (ticket) {
      // Validate AND consume ticket to enforce single-use authorization
      await consumeTransactionTicket(ticket, userId, context);
      return;
    }

    throw ApiError.unauthorized(
      'Transaction authorization required: provide pin or transactionTicket',
      'AUTH_REQUIRED'
    );
  }

  /**
   * Generates a unique deterministic transaction reference.
   * Format: TXN-YYYYMMDD-<8 random hex chars>
   *
   * @returns {string}
   */
  static generateTransactionReference() {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `TXN-${date}-${random}`;
  }

  /**
   * Executes a P2P atomic fund transfer.
   *
   * Flow:
   *   1. Resolve receiver
   *   2. Guard: sender ≠ receiver
   *   3. Authorize transfer via PIN or Transaction Ticket (single-use consumed)
   *   4. AML velocity check
   *   5. Call transfer_funds_atomic RPC (handles locking, balance check, fee, ledger)
   *   6. Return formatted receipt
   *
   * @param {string} senderId - From req.userId (JWT-verified, never client body)
   * @param {object} params - Transfer parameters
   * @returns {Promise<object>} Transfer receipt
   */
  static async executeTransfer(senderId, params) {
    const {
      receiverPhone,
      receiver_phone,
      receiverEmail,
      receiver_email,
      receiverId,
      receiver_id,
      amount,
      fee: rawFee,
      category,
      note,
      pin,
      transactionTicket,
      transaction_ticket,
      idempotencyKey,
      currency = 'USD'
    } = params;

    // Validate fee
    const fee = rawFee !== undefined ? parseFloat(rawFee) : PLATFORM_FEE;
    if (isNaN(fee) || fee < 0) {
      throw ApiError.badRequest('Fee must be a non-negative number', 'INVALID_FEE');
    }

    // 1. Resolve receiver
    const receiver = await this.resolveReceiver({
      receiverPhone: receiverPhone || receiver_phone,
      receiverEmail: receiverEmail || receiver_email,
      receiverId: receiverId || receiver_id
    });

    // 2. Guard: no self-transfers
    if (senderId === receiver.id) {
      throw ApiError.badRequest(
        'You cannot transfer funds to yourself',
        'SELF_TRANSFER_NOT_ALLOWED'
      );
    }

    // 3. Authorize transfer (PIN verification or ticket consumption)
    await this.authorizeTransfer(
      {
        pin,
        transactionTicket: transactionTicket || transaction_ticket
      },
      senderId,
      {
        transferParams: {
          amount,
          receiverId: receiver.id
        }
      }
    );

    // 4. AML velocity check (evaluated on total transfer amount)
    await AmlService.validateTransferLimits(senderId, amount);

    // 5. Generate unique transaction reference
    const txReference = this.generateTransactionReference();

    // 6. Call atomic PostgreSQL RPC
    const { data: receiptData, error: rpcError } = await supabaseAdmin.rpc(
      'transfer_funds_atomic',
      {
        p_sender_id: senderId,
        p_receiver_id: receiver.id,
        p_amount: amount,
        p_fee: fee,
        p_currency: currency,
        p_category: category,
        p_note: note || null,
        p_idempotency_key: idempotencyKey,
        p_tx_reference: txReference
      }
    );

    if (rpcError) {
      const msg = rpcError.message || '';

      if (msg.includes('Insufficient funds')) {
        throw ApiError.badRequest(
          'Insufficient funds: your wallet balance is too low for this transfer',
          'INSUFFICIENT_FUNDS'
        );
      }
      if (msg.includes('not ACTIVE')) {
        throw ApiError.badRequest(
          'Transfer failed: one or more wallets are not active',
          'WALLET_INACTIVE'
        );
      }
      if (msg.includes('not found')) {
        throw ApiError.notFound('Wallet not found for the specified currency', 'WALLET_NOT_FOUND');
      }
      if (msg.includes('same user')) {
        throw ApiError.badRequest('You cannot transfer funds to yourself', 'SELF_TRANSFER_NOT_ALLOWED');
      }
      if (msg.includes('Authorization violation')) {
        throw ApiError.forbidden('Authorization violation on transfer execution', 'TRANSFER_UNAUTHORIZED');
      }

      logger.error({ err: msg, senderId, receiverId: receiver.id }, 'transfer_funds_atomic RPC error');
    }

    // 7. Post-commit notification dispatch (strictly non-blocking per Financial Integration Rule)
    try {
      await NotificationService.notifyTransferReceived({
        senderId,
        receiverId: receiver.id,
        amount: receiptData.amount,
        currency: receiptData.currency,
        transactionId: receiptData.transactionId,
        transactionReference: receiptData.transactionReference,
        note: receiptData.note
      });
    } catch (notifErr) {
      logger.error({ err: notifErr.message, txId: receiptData.transactionId }, 'Failed to dispatch transfer notification (non-fatal)');
    }

    // 8. Format and return receipt
    return {
      transactionId: receiptData.transactionId,
      transactionReference: receiptData.transactionReference,
      sender: { id: senderId },
      receiver: {
        id: receiver.id,
        firstName: receiver.firstName,
        lastName: receiver.lastName
      },
      amount: formatMoney(receiptData.amount),
      fee: formatMoney(receiptData.fee),
      currency: receiptData.currency,
      status: receiptData.status,
      category: receiptData.category,
      note: receiptData.note,
      senderBalanceAfter: formatMoney(receiptData.senderBalanceAfter),
      receiverBalanceAfter: formatMoney(receiptData.receiverBalanceAfter),
      feeWalletBalanceAfter: receiptData.feeWalletBalanceAfter ? formatMoney(receiptData.feeWalletBalanceAfter) : undefined,
      settledAt: receiptData.settledAt
    };
  }

  /**
   * Retrieves a transfer receipt by transaction reference.
   * Only allows the sender or receiver to view the receipt.
   *
   * @param {string} reference - Transaction reference (e.g. TXN-20260912-ABCD1234)
   * @param {string} requestingUserId - Authenticated user UUID
   * @returns {Promise<object>} Transaction receipt
   */
  static async getTransferByReference(reference, requestingUserId) {
    const { data: tx, error } = await supabaseAdmin
      .from('transactions')
      .select(`
        id,
        transaction_reference,
        sender_id,
        receiver_id,
        amount,
        fee,
        currency,
        type,
        status,
        category,
        note,
        created_at,
        settled_at,
        sender:profiles!transactions_sender_id_fkey(id, first_name, last_name),
        receiver:profiles!transactions_receiver_id_fkey(id, first_name, last_name)
      `)
      .eq('transaction_reference', reference)
      .single();

    if (error || !tx) {
      throw ApiError.notFound(
        `Transfer with reference "${reference}" not found`,
        'TRANSFER_NOT_FOUND'
      );
    }

    // Authorization: only sender or receiver may view this receipt
    if (tx.sender_id !== requestingUserId && tx.receiver_id !== requestingUserId) {
      throw ApiError.forbidden(
        'You are not authorized to view this transfer',
        'TRANSFER_ACCESS_DENIED'
      );
    }

    return {
      transactionId: tx.id,
      transactionReference: tx.transaction_reference,
      sender: tx.sender
        ? { id: tx.sender_id, firstName: tx.sender.first_name, lastName: tx.sender.last_name }
        : { id: tx.sender_id },
      receiver: tx.receiver
        ? { id: tx.receiver_id, firstName: tx.receiver.first_name, lastName: tx.receiver.last_name }
        : { id: tx.receiver_id },
      amount: formatMoney(tx.amount),
      fee: formatMoney(tx.fee),
      currency: tx.currency,
      type: tx.type,
      status: tx.status,
      category: tx.category,
      note: tx.note,
      createdAt: tx.created_at,
      settledAt: tx.settled_at
    };
  }
}

module.exports = TransferService;
