const crypto = require('crypto');
const PaymentGatewayInterface = require('./payment_gateway.interface');

/**
 * Mock Payment Gateway Adapter
 * ============================
 * Provides an offline, deterministic mock implementation of the payment gateway
 * interface for testing, CI/CD, and local sandbox environments without
 * requiring active external Stripe accounts.
 */
class MockPaymentGatewayAdapter extends PaymentGatewayInterface {
  constructor(secret = process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET || 'test_webhook_secret_key_bwallet_2026') {
    super();
    this.secret = secret;
  }

  /**
   * Creates a mock payment intent.
   */
  async createPaymentIntent({ amount, currency = 'USD', customerId, paymentMethodId, metadata = {} }) {
    const id = `pi_mock_${crypto.randomUUID().replace(/-/g, '')}`;
    const clientSecret = `${id}_secret_${crypto.randomBytes(12).toString('hex')}`;

    return {
      id,
      clientSecret,
      amount: parseFloat(Number(amount).toFixed(2)),
      currency: currency.toUpperCase(),
      status: 'requires_payment_method',
      customerId: customerId || null,
      paymentMethodId: paymentMethodId || null,
      metadata
    };
  }

  /**
   * Retrieves a mock payment intent.
   */
  async retrievePaymentIntent(intentId) {
    return {
      id: intentId,
      status: 'succeeded',
      amount: 100.00,
      currency: 'USD',
      metadata: {}
    };
  }

  /**
   * Generates a valid HMAC-SHA256 signature for testing / webhook simulation.
   *
   * @param {Object} options
   * @param {Buffer|string} options.payload - Request payload
   * @param {string} [options.secret] - Signing secret
   * @param {number} [options.timestamp] - Timestamp in seconds
   * @returns {{ signature: string, timestamp: number, header: string }}
   */
  generateWebhookSignature({ payload, secret = this.secret, timestamp = Math.floor(Date.now() / 1000) }) {
    const stringBody = Buffer.isBuffer(payload) ? payload.toString('utf8') : (typeof payload === 'string' ? payload : JSON.stringify(payload));
    const signedPayload = `${timestamp}.${stringBody}`;
    const hmac = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    const header = `t=${timestamp},v1=${hmac}`;

    return {
      signature: hmac,
      timestamp,
      header
    };
  }

  /**
   * Verifies an HMAC-SHA256 signature against the raw body.
   * Supports both Stripe format (`t=timestamp,v1=signature`) and standalone HMAC hex.
   */
  verifyWebhookSignature({ rawBody, signature, secret = this.secret, timestamp, tolerance = 300 }) {
    if (!rawBody || !signature || !secret) {
      return false;
    }

    const stringBody = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : (typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody));
    let parsedTimestamp = timestamp ? parseInt(timestamp, 10) : null;
    let expectedSignatures = [];

    // Case 1: Stripe-formatted header: "t=1726300000,v1=abcdef...,v0=..."
    if (typeof signature === 'string' && signature.includes('=')) {
      const parts = signature.split(',').map(part => part.trim().split('='));
      for (const [key, value] of parts) {
        if (key === 't') {
          parsedTimestamp = parseInt(value, 10);
        } else if (key === 'v1') {
          expectedSignatures.push(value);
        }
      }
    } else {
      expectedSignatures.push(signature);
    }

    if (expectedSignatures.length === 0) {
      return false;
    }

    // Timestamp replay attack check
    if (parsedTimestamp !== null) {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      if (Math.abs(currentTimestamp - parsedTimestamp) > tolerance) {
        return false; // Signature expired or from the future outside tolerance
      }
    }

    // Verify cryptographic signature
    for (const sigToMatch of expectedSignatures) {
      // Calculate HMAC with timestamp if present, otherwise direct raw body
      const payloadToSign = parsedTimestamp !== null ? `${parsedTimestamp}.${stringBody}` : stringBody;
      const computedHash = crypto.createHmac('sha256', secret).update(payloadToSign).digest('hex');

      try {
        const computedBuffer = Buffer.from(computedHash, 'utf8');
        const candidateBuffer = Buffer.from(sigToMatch, 'utf8');

        if (computedBuffer.length === candidateBuffer.length && crypto.timingSafeEqual(computedBuffer, candidateBuffer)) {
          return true;
        }
      } catch (err) {
        // Continue checking other signatures if any
      }

      // Also support direct match if timestamp was provided as separate header but not in signed string
      if (parsedTimestamp !== null) {
        const directHash = crypto.createHmac('sha256', secret).update(stringBody).digest('hex');
        try {
          const directBuffer = Buffer.from(directHash, 'utf8');
          const candidateBuffer = Buffer.from(sigToMatch, 'utf8');
          if (directBuffer.length === candidateBuffer.length && crypto.timingSafeEqual(directBuffer, candidateBuffer)) {
            return true;
          }
        } catch (err) {}
      }
    }

    return false;
  }
}

module.exports = MockPaymentGatewayAdapter;
