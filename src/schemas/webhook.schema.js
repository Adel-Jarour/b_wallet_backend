const { z } = require('zod');

const webhookPayloadSchema = z.object({
  id: z.string().optional(),
  event: z.string().optional(),
  type: z.string().optional(),
  data: z.record(z.any()),
  created: z.number().optional()
}).superRefine((data, ctx) => {
  const eventName = data.event || data.type;
  if (!eventName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Webhook payload must specify "event" or "type"',
      path: ['event']
    });
  }
});

module.exports = {
  webhookPayloadSchema
};
