const { z } = require('zod');

// Password requirement: min 8 chars, at least 1 uppercase letter, 1 digit, 1 special character
const strongPasswordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const registerSchema = z.object({
  email: z.string().email('Valid email address is required').max(255),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .regex(
      strongPasswordRegex,
      'Password must contain at least 1 uppercase letter, 1 digit, and 1 special character'
    ),
  firstName: z.string().min(1, 'First name is required').max(100).trim(),
  lastName: z.string().min(1, 'Last name is required').max(100).trim(),
  phoneNumber: z.string().max(20).optional()
});

const loginSchema = z.object({
  email: z.string().email('Valid email address is required'),
  password: z.string().min(1, 'Password is required')
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required')
});

const passwordRecoveryRequestSchema = z.object({
  email: z.string().email('Valid email address is required')
});

const verifyOtpSchema = z.object({
  email: z.string().email('Valid email address is required'),
  token: z.string().min(6, 'OTP must be 6 digits').max(10, 'OTP is too long').trim(),
  type: z.enum(['recovery', 'signup', 'magiclink', 'email_change', 'sms']).default('recovery')
});

const resetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters long')
    .regex(
      strongPasswordRegex,
      'Password must contain at least 1 uppercase letter, 1 digit, and 1 special character'
    ),
  token: z.string().optional()
});

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema,
  passwordRecoveryRequestSchema,
  verifyOtpSchema,
  resetPasswordSchema
};
