const { z } = require('zod');

const cashFlowQuerySchema = z.object({
  period: z.enum(['weekly', 'monthly', 'yearly'], {
    errorMap: () => ({ message: 'period must be one of: weekly, monthly, yearly' })
  }).default('monthly'),

  currency: z
    .string()
    .length(3, 'currency must be a 3-letter ISO code')
    .default('USD')
    .transform(c => c.toUpperCase()),

  start_date: z
    .string()
    .refine(val => !isNaN(Date.parse(val)), { message: 'start_date must be a valid ISO 8601 date string' })
    .optional(),

  startDate: z
    .string()
    .refine(val => !isNaN(Date.parse(val)), { message: 'startDate must be a valid ISO 8601 date string' })
    .optional(),

  end_date: z
    .string()
    .refine(val => !isNaN(Date.parse(val)), { message: 'end_date must be a valid ISO 8601 date string' })
    .optional(),

  endDate: z
    .string()
    .refine(val => !isNaN(Date.parse(val)), { message: 'endDate must be a valid ISO 8601 date string' })
    .optional()
}).superRefine((data, ctx) => {
  const startStr = data.start_date || data.startDate;
  const endStr = data.end_date || data.endDate;

  if (startStr && endStr) {
    const start = new Date(startStr);
    const end = new Date(endStr);

    if (start > end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'start_date cannot be later than end_date',
        path: ['start_date']
      });
    }

    const diffDays = (end - start) / (1000 * 60 * 60 * 24);
    if (diffDays > 1826) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Date range cannot exceed 5 years (1826 days)',
        path: ['end_date']
      });
    }
  }
}).transform((data) => ({
  period: data.period,
  currency: data.currency,
  start_date: data.start_date || data.startDate || null,
  end_date: data.end_date || data.endDate || null
}));

module.exports = {
  cashFlowQuerySchema
};
