const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { paymentGateway } = require('./gateways');
const CardService = require('./card.service');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const { env } = require('../config/env');

/**
 * Derives a deterministic UUIDv4-formatted string from an arbitrary string.
 */
function toDeterministicUuid(str) {
  const hash = crypto.createHash('sha256').update(String(str)).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

class TopUpService {
  /**
   * Initiates a top-up payment intent with the payment gateway adapter.
   */
  static async createIntent(userId, { amount, currency = 'USD', cardId, paymentMethodId }) {
    // 1. Fetch user's active wallet for currency
    const { data: wallet, error: walletErr } = await supabaseAdmin
      .from('wallets')
      .select('id, user_id, currency, balance, status')
      .eq('user_id', userId)
      .eq('currency', currency)
      .single();

    if (walletErr || !wallet) {
      throw ApiError.notFound(`Active ${currency} wallet not found for user`, 'WALLET_NOT_FOUND');
    }

    if (wallet.status !== 'ACTIVE') {
      throw ApiError.forbidden(`Wallet is ${wallet.status}. Top-up is only allowed for ACTIVE wallets.`, 'WALLET_NOT_ACTIVE');
    }

    // 2. Resolve tokenized payment method if cardId is provided
    let gatewayPaymentMethodId = paymentMethodId || null;
    let gatewayCustomerId = null;

    if (cardId) {
      const card = await CardService.getCardById(userId, cardId);
      gatewayPaymentMethodId = card.gateway_payment_method_id;
      gatewayCustomerId = card.gateway_customer_id || null;
    }

    // 3. Create payment intent via gateway adapter
    const intent = await paymentGateway.createPaymentIntent({
      amount,
      currency,
      customerId: gatewayCustomerId,
      paymentMethodId: gatewayPaymentMethodId,
      metadata: {
        user_id: userId,
        wallet_id: wallet.id,
        currency: wallet.currency
      }
    });

    logger.info({
      userId,
      walletId: wallet.id,
      amount,
      currency,
      intentId: intent.id
    }, 'Top-up payment intent created');

    return {
      paymentIntentId: intent.id,
      clientSecret: intent.clientSecret,
      amount: intent.amount,
      currency: intent.currency,
      status: intent.status
    };
  }

  /**
   * Processes an incoming payment gateway webhook.
   * Cryptographically verifies HMAC-SHA256 signature and executes atomic settlement.
   */
  static async handleWebhook(rawBody, headers) {
    const signature = headers['x-webhook-signature'] || headers['stripe-signature'] || headers['x-signature'];
    const timestamp = headers['x-webhook-timestamp'] || headers['x-timestamp'] || null;

    if (!signature) {
      throw ApiError.unauthorized('Missing webhook cryptographic signature header', 'WEBHOOK_SIGNATURE_MISSING');
    }

    // 1. Verify cryptographic signature
    const secret = env.PAYMENT_GATEWAY_WEBHOOK_SECRET || process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET;
    const isValid = paymentGateway.verifyWebhookSignature({
      rawBody,
      signature,
      secret,
      timestamp,
      tolerance: 300 // 5-minute replay attack tolerance
    });

    if (!isValid) {
      logger.warn({ signature: signature?.slice(0, 16) + '...' }, 'Webhook signature verification failed');
      throw ApiError.unauthorized('Invalid or expired webhook signature', 'WEBHOOK_SIGNATURE_INVALID');
    }

    // 2. Parse payload
    let payload;
    try {
      const rawString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
      payload = JSON.parse(rawString);
    } catch (err) {
      throw ApiError.badRequest('Invalid JSON payload in webhook body', 'WEBHOOK_MALFORMED_JSON');
    }

    const eventType = payload.event || payload.type;
    if (!eventType) {
      throw ApiError.badRequest('Webhook missing event type', 'WEBHOOK_EVENT_MISSING');
    }

    // 3. Process settlement events
    if (eventType !== 'payment_intent.succeeded' && eventType !== 'charge.succeeded') {
      logger.info({ eventType }, 'Ignoring non-settlement webhook event');
      return {
        received: true,
        status: 'ignored',
        message: `Event ${eventType} acknowledged without action`
      };
    }

    const dataObj = payload.data?.object || payload.data || {};
    const intentId = dataObj.id || `ext_${Date.now()}`;
    const metadata = dataObj.metadata || {};

    // Extract amount
    let amount = 0;
    if (dataObj.amount !== undefined) {
      // If amount appears to be in cents (integer > 0 and no decimals, or from Stripe)
      if (typeof dataObj.amount === 'number' && Number.isInteger(dataObj.amount) && payload.type?.startsWith('payment_intent')) {
        amount = parseFloat((dataObj.amount / 100).toFixed(2));
      } else {
        amount = parseFloat(Number(dataObj.amount).toFixed(2));
      }
    }

    if (amount <= 0) {
      throw ApiError.badRequest('Webhook payment amount must be greater than zero', 'INVALID_AMOUNT');
    }

    // Determine target wallet
    let walletId = metadata.wallet_id || metadata.walletId;
    const userId = metadata.user_id || metadata.userId;

    if (!walletId && userId) {
      const currency = (dataObj.currency || 'USD').toUpperCase();
      const { data: userWallet } = await supabaseAdmin
        .from('wallets')
        .select('id')
        .eq('user_id', userId)
        .eq('currency', currency)
        .single();
      if (userWallet) {
        walletId = userWallet.id;
      }
    }

    if (!walletId) {
      throw ApiError.badRequest('Target wallet could not be resolved from webhook metadata', 'TARGET_WALLET_NOT_FOUND');
    }

    const txReference = `TOP-${intentId}`;
    const idempotencyKey = metadata.idempotency_key || toDeterministicUuid(intentId);

    // 4. Execute atomic wallet crediting via stored procedure
    const { data: receipt, error: rpcErr } = await supabaseAdmin.rpc('top_up_wallet_atomic', {
      p_wallet_id: walletId,
      p_amount: amount,
      p_reference: txReference,
      p_idempotency_key: idempotencyKey
    });

    if (rpcErr) {
      logger.error({ err: rpcErr.message, walletId, amount, txReference }, 'top_up_wallet_atomic RPC execution failed');
      throw ApiError.internal(`Top-up execution failed: ${rpcErr.message}`);
    }

    if (receipt.already_processed) {
      logger.info({ intentId, txReference }, 'Duplicate webhook delivery: top-up was already processed');
      return {
        received: true,
        status: 'already_processed',
        receipt
      };
    }

    logger.info({
      intentId,
      txReference,
      walletId,
      amount,
      balanceAfter: receipt.balance_after
    }, 'Top-up completed and wallet credited successfully');

    return {
      received: true,
      status: 'success',
      receipt
    };
  }
}

module.exports = TopUpService;
