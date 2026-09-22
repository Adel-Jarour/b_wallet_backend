const { z } = require('zod');

const ALLOWED_CATEGORIES = ['Food', 'Expense', 'Property', 'Hobby', 'Entertainment'];

/**
 * Schema for POST /api/v1/transfers
 * Body validation for initiating a P2P fund transfer.
 * Supports both camelCase and snake_case field names per REST conventions.
 */
const transferSchema = z.object({
  // Recipient identifiers
  receiverPhone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, 'receiverPhone must be a valid E.164 phone number (e.g. +15551234567)')
    .optional(),
  receiver_phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, 'receiver_phone must be a valid E.164 phone number (e.g. +15551234567)')
    .optional(),

  receiverEmail: z
    .string()
    .email('receiverEmail must be a valid email address')
    .optional(),
  receiver_email: z
    .string()
    .email('receiver_email must be a valid email address')
    .optional(),

  receiverId: z
    .string()
    .uuid('receiverId must be a valid UUID')
    .optional(),
  receiver_id: z
    .string()
    .uuid('receiver_id must be a valid UUID')
    .optional(),

  // Amount: positive, max 2 decimal places, max $2,500 (AML single-transfer limit)
  amount: z
    .number({
      required_error: 'amount is required',
      invalid_type_error: 'amount must be a number'
    })
    .positive('amount must be greater than 0')
    .max(2500, 'Single transfer limit is $2,500.00 (NFR-COMP-002 AML velocity limit)')
    .refine(
      val => /^\d+(\.\d{1,2})?$/.test(String(val)),
      'amount cannot have more than 2 decimal places'
    ),

  // Optional platform fee: non-negative, max 2 decimal places
  fee: z
    .number({
      invalid_type_error: 'fee must be a number'
    })
    .min(0, 'fee must be non-negative')
    .refine(
      val => /^\d+(\.\d{1,2})?$/.test(String(val)),
      'fee cannot have more than 2 decimal places'
    )
    .optional(),

  // Transaction category
  category: z
    .enum(ALLOWED_CATEGORIES, {
      errorMap: () => ({
        message: `category must be one of: ${ALLOWED_CATEGORIES.join(', ')}`
      })
    }),

  // Optional note/memo
  note: z
    .string()
    .max(255, 'note cannot exceed 255 characters')
    .optional()
    .nullable(),

  // Direct 6-digit PIN OR pre-authorized transaction ticket
  pin: z
    .string()
    .regex(/^\d{6}$/, 'PIN must be exactly 6 numeric digits')
    .optional(),
  transactionTicket: z
    .string()
    .min(1, 'transactionTicket cannot be empty')
    .optional(),
  transaction_ticket: z
    .string()
    .min(1, 'transaction_ticket cannot be empty')
    .optional()
})
.refine(
  data => Boolean(data.receiverPhone || data.receiver_phone || data.receiverEmail || data.receiver_email || data.receiverId || data.receiver_id),
  {
    message: 'At least one recipient identifier (receiver_phone, receiver_email, or receiver_id) must be provided',
    path: ['receiver_phone']
  }
)
.refine(
  data => Boolean(data.pin || data.transactionTicket || data.transaction_ticket),
  {
    message: 'Either pin (6 digits) or transactionTicket is required for transfer authorization',
    path: ['pin']
  }
);

module.exports = {
  transferSchema,
  ALLOWED_CATEGORIES
};
