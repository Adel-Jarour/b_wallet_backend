const { z } = require('zod');

const createTopUpIntentSchema = z.object({
  amount: z.coerce
    .number({ invalid_type_error: 'Amount must be a valid number' })
    .positive('Top-up amount must be strictly greater than 0')
    .max(10000.00, 'Top-up amount cannot exceed $10,000.00 per transaction')
    .refine(val => /^\d+(\.\d{1,2})?$/.test(val.toFixed(2)), {
      message: 'Amount cannot have more than 2 decimal places'
    }),

  currency: z.string().length(3, 'Currency must be a 3-character ISO code').default('USD').transform(c => c.toUpperCase()),

  card_id: z.string().uuid('card_id must be a valid UUID').optional(),
  cardId: z.string().uuid('cardId must be a valid UUID').optional(),

  payment_method_id: z.string().optional(),
  paymentMethodId: z.string().optional()
}).transform((data) => ({
  amount: parseFloat(data.amount.toFixed(2)),
  currency: data.currency,
  card_id: data.card_id || data.cardId || null,
  payment_method_id: data.payment_method_id || data.paymentMethodId || null
}));

module.exports = {
  createTopUpIntentSchema
};
