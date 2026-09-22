const MockPaymentGatewayAdapter = require('./mock.adapter');
const StripePaymentGatewayAdapter = require('./stripe.adapter');
const PaymentGatewayInterface = require('./payment_gateway.interface');

function getPaymentGateway() {
  const adapterType = (process.env.PAYMENT_GATEWAY_ADAPTER || 'mock').toLowerCase();

  if (adapterType === 'stripe' && process.env.STRIPE_SECRET_KEY) {
    return new StripePaymentGatewayAdapter();
  }

  return new MockPaymentGatewayAdapter();
}

const defaultGateway = getPaymentGateway();

module.exports = {
  PaymentGatewayInterface,
  MockPaymentGatewayAdapter,
  StripePaymentGatewayAdapter,
  paymentGateway: defaultGateway,
  getPaymentGateway
};
