const express = require('express');
const AuthController = require('../controllers/auth.controller');
const validate = require('../middlewares/validate');
const { authenticateJwt } = require('../middlewares/auth');
const { authLimiter } = require('../middlewares/rateLimiter');
const {
  registerSchema,
  loginSchema,
  refreshSchema,
  passwordRecoveryRequestSchema,
  verifyOtpSchema,
  resetPasswordSchema
} = require('../schemas/auth.schema');

const router = express.Router();

// Public routes with auth rate limiter
router.post('/register', authLimiter, validate(registerSchema), AuthController.register);
router.post('/login', authLimiter, validate(loginSchema), AuthController.login);
router.post('/refresh', authLimiter, validate(refreshSchema), AuthController.refresh);

// Password recovery & OTP with auth rate limiter
router.post(
  '/password-recovery/request',
  authLimiter,
  validate(passwordRecoveryRequestSchema),
  AuthController.requestPasswordRecovery
);
router.post(
  '/password-recovery/verify-otp',
  authLimiter,
  validate(verifyOtpSchema),
  AuthController.verifyRecoveryOtp
);
router.post(
  '/password-recovery/reset',
  authenticateJwt,
  validate(resetPasswordSchema),
  AuthController.resetPassword
);

// Protected routes
router.post('/logout', authenticateJwt, AuthController.logout);

module.exports = router;
