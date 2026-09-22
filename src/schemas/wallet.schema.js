const { z } = require('zod');

/**
 * Validation schema for paginated ledger queries
 * GET /api/v1/wallets/me/ledger?page=1&limit=20&direction=DEBIT
 */
const ledgerPaginationSchema = z.object({
  page: z
    .string()
    .optional()
    .default('1')
    .transform(val => parseInt(val, 10))
    .refine(val => !isNaN(val) && val >= 1, {
      message: 'Page must be an integer greater than or equal to 1'
    }),
  limit: z
    .string()
    .optional()
    .default('20')
    .transform(val => parseInt(val, 10))
    .refine(val => !isNaN(val) && val >= 1 && val <= 100, {
      message: 'Limit must be an integer between 1 and 100'
    }),
  direction: z
    .enum(['DEBIT', 'CREDIT'])
    .optional()
});

module.exports = {
  ledgerPaginationSchema
};
