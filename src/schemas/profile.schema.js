const { z } = require('zod');

const updateProfileSchema = z.object({
  firstName: z.string().max(100).trim().optional(),
  lastName: z.string().max(100).trim().optional(),
  phoneNumber: z.string().max(20).trim().optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must follow YYYY-MM-DD format')
    .optional(),
  avatarUrl: z.string().url('avatarUrl must be a valid URL').optional()
});

module.exports = {
  updateProfileSchema
};
