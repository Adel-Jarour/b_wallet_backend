/**
 * Payment Gateway Adapter Interface
 * =================================
 * Defines the contract that all external payment processor integrations
 * (e.g., Stripe Sandbox, Mock Gateway, Checkout.com) must adhere to.
 *
 * Conforms to Architectural Decision 5 (Modular Payment Gateway Interface)
 * and PCI-DSS Level 4 compliance (zero raw card handling).
 */

class PaymentGatewayInterface {
  /**
   * Creates a payment intent with the external gateway.
   *
   * @param {Object} params
   * @param {number|string} params.amount - Monetary amount in decimal units (e.g. 100.00)
   * @param {string} params.currency - ISO 4217 3-letter currency code (e.g. 'USD')
   * @param {string} [params.customerId] - Optional gateway customer token
   * @param {string} [params.paymentMethodId] - Optional gateway tokenized payment method ID
   * @param {Object} [params.metadata] - Key-value metadata (e.g. userId, walletId)
   * @returns {Promise<{
   *   id: string,
   *   clientSecret: string,
   *   amount: number,
   *   currency: string,
   *   status: string,
   *   metadata: Object
   * }>}
   */
  async createPaymentIntent(params) {
    throw new Error('PaymentGatewayInterface.createPaymentIntent() must be implemented');
  }

  /**
   * Retrieves status and details of an existing payment intent.
   *
   * @param {string} intentId - Payment intent ID
   * @returns {Promise<Object>}
   */
  async retrievePaymentIntent(intentId) {
    throw new Error('PaymentGatewayInterface.retrievePaymentIntent() must be implemented');
  }

  /**
   * Verifies the cryptographic HMAC-SHA256 signature of an inbound webhook payload.
   *
   * @param {Object} params
   * @param {Buffer|string} params.rawBody - Exact unparsed raw bytes received from gateway
   * @param {string} params.signature - Signature header from request
   * @param {string} params.secret - Shared webhook signing secret
   * @param {number|string} [params.timestamp] - Timestamp header or extracted timestamp
   * @param {number} [params.tolerance] - Maximum allowed age in seconds (default: 300)
   * @returns {boolean} True if signature is cryptographically valid and not replayed
   */
  verifyWebhookSignature(params) {
    throw new Error('PaymentGatewayInterface.verifyWebhookSignature() must be implemented');
  }
}

module.exports = PaymentGatewayInterface;
