const { z } = require('zod');

// Forbidden raw card fields under PCI-DSS Level 4 compliance
const FORBIDDEN_RAW_FIELDS = [
  'card_number',
  'cardnumber',
  'card_no',
  'pan',
  'primary_account_number',
  'cvc',
  'cvv',
  'cvv2',
  'cvc2',
  'security_code',
  'pin'
];

/**
 * Checks if the payload contains any forbidden raw card data.
 */
function checkForbiddenRawFields(data) {
  if (!data || typeof data !== 'object') return null;
  const keys = Object.keys(data).map(k => k.toLowerCase().replace(/[-_]/g, ''));
  for (const forbidden of FORBIDDEN_RAW_FIELDS) {
    const normalized = forbidden.replace(/[-_]/g, '');
    if (keys.includes(normalized)) {
      return forbidden;
    }
  }
  return null;
}

const saveCardSchema = z.object({
  gateway_payment_method_id: z.string().min(1, 'gateway_payment_method_id is required').optional(),
  gatewayPaymentMethodId: z.string().min(1).optional(),

  gateway_customer_id: z.string().optional().nullable(),
  gatewayCustomerId: z.string().optional().nullable(),

  brand: z.enum(['Visa', 'MasterCard', 'Amex', 'Discover', 'UnionPay', 'JCB', 'Other'], {
    errorMap: () => ({ message: 'brand must be one of: Visa, MasterCard, Amex, Discover, UnionPay, JCB, Other' })
  }),

  last4: z.string().regex(/^\d{4}$/, 'last4 must be exactly 4 numeric digits'),

  expiry_month: z.coerce.number().int().min(1).max(12).optional(),
  expiryMonth: z.coerce.number().int().min(1).max(12).optional(),

  expiry_year: z.coerce.number().int().min(2026, 'expiry_year must be 2026 or later').optional(),
  expiryYear: z.coerce.number().int().min(2026, 'expiryYear must be 2026 or later').optional(),

  is_default: z.boolean().default(false).optional(),
  isDefault: z.boolean().default(false).optional()
}).superRefine((data, ctx) => {
  const token = data.gateway_payment_method_id || data.gatewayPaymentMethodId;
  if (!token) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'gateway_payment_method_id is required',
      path: ['gateway_payment_method_id']
    });
  }

  const month = data.expiry_month || data.expiryMonth;
  if (!month) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'expiry_month is required (1-12)',
      path: ['expiry_month']
    });
  }

  const year = data.expiry_year || data.expiryYear;
  if (!year) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'expiry_year is required (>= 2026)',
      path: ['expiry_year']
    });
  }

  // Expiration freshness check: cannot be earlier than current month in current year
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  if (year && month && year === currentYear && month < currentMonth) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Card expiration date cannot be in the past',
      path: ['expiry_month']
    });
  }
}).transform((data) => ({
  gateway_payment_method_id: data.gateway_payment_method_id || data.gatewayPaymentMethodId,
  gateway_customer_id: data.gateway_customer_id || data.gatewayCustomerId || null,
  brand: data.brand,
  last4: data.last4,
  expiry_month: data.expiry_month || data.expiryMonth,
  expiry_year: data.expiry_year || data.expiryYear,
  is_default: data.is_default !== undefined ? data.is_default : (data.isDefault !== undefined ? data.isDefault : false)
}));

module.exports = {
  saveCardSchema,
  checkForbiddenRawFields,
  FORBIDDEN_RAW_FIELDS
};
