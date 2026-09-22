const { z } = require('zod');

const ALLOWED_CATEGORIES = ['Food', 'Expense', 'Property', 'Hobby', 'Entertainment'];
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

/**
 * Schema for POST /api/v1/requests
 * Create a new payment request targeting another user.
 */
const createRequestSchema = z.object({
  // Recipient identifier — one of phone, email, or userId required
  payerPhone: z.string().regex(E164_REGEX, 'payerPhone must be E.164 format (e.g. +15551234567)').optional(),
  payer_phone: z.string().regex(E164_REGEX, 'payer_phone must be E.164 format (e.g. +15551234567)').optional(),

  payerEmail: z.string().email('payerEmail must be a valid email address').optional(),
  payer_email: z.string().email('payer_email must be a valid email address').optional(),

  payerId: z.string().uuid('payerId must be a valid UUID').optional(),
  payer_id: z.string().uuid('payer_id must be a valid UUID').optional(),

  // Financial fields
  amount: z
    .number({ required_error: 'amount is required', invalid_type_error: 'amount must be a number' })
    .positive('amount must be greater than 0')
    .multipleOf(0.01, 'amount must have at most 2 decimal places')
    .max(2500, 'Single request limit is $2,500.00'),

  currency: z.string().length(3, 'currency must be exactly 3 characters').default('USD'),

  category: z.enum(ALLOWED_CATEGORIES, {
    errorMap: () => ({ message: `category must be one of: ${ALLOWED_CATEGORIES.join(', ')}` })
  }).optional(),

  note: z.string().max(255, 'note must be at most 255 characters').optional()
}).refine(
  (d) => d.payerPhone || d.payer_phone || d.payerEmail || d.payer_email || d.payerId || d.payer_id,
  { message: 'A payer identifier is required: payerPhone, payerEmail, or payerId' }
);

/**
 * Schema for GET /api/v1/requests query parameters
 */
const listRequestsSchema = z.object({
  status: z.enum(['PENDING', 'COMPLETED', 'DECLINED', 'CANCELLED']).optional(),
  direction: z.enum(['sent', 'received', 'all']).default('all'),
  page: z.coerce.number().int().min(1, 'Page must be >= 1').default(1),
  limit: z.coerce.number().int().min(1).max(100, 'Limit must be <= 100').default(20)
});

/**
 * Schema for POST /api/v1/requests/:id/pay
 * Settle a payment request — requires PIN or transaction ticket.
 */
const payRequestSchema = z.object({
  pin: z
    .string()
    .regex(/^\d{6}$/, 'PIN must be exactly 6 numeric digits')
    .optional(),
  transactionTicket: z.string().min(10, 'transactionTicket is invalid').optional(),
  transaction_ticket: z.string().min(10, 'transaction_ticket is invalid').optional()
}).refine(
  (d) => d.pin || d.transactionTicket || d.transaction_ticket,
  { message: 'Transaction authorization required: provide pin or transactionTicket' }
);

module.exports = {
  createRequestSchema,
  listRequestsSchema,
  payRequestSchema
};
