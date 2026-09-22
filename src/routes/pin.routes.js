const express = require('express');
const PinController = require('../controllers/pin.controller');
const validate = require('../middlewares/validate');
const { authenticateJwt } = require('../middlewares/auth');
const { pinLimiter } = require('../middlewares/rateLimiter');
const {
  setupPinSchema,
  verifyPinSchema,
  changePinSchema
} = require('../schemas/pin.schema');

const router = express.Router();

// All PIN routes require valid JWT authentication
router.use(authenticateJwt);

// GET /api/v1/auth/pin/status - Inquire whether PIN is set and lockout state
router.get('/status', PinController.getStatus);

// POST /api/v1/auth/pin/setup - Initial PIN creation (validates 6 digits & confirmation match)
router.post('/setup', pinLimiter, validate(setupPinSchema), PinController.setup);

// POST /api/v1/auth/pin/verify - Validates PIN, increments attempt count, enforces 15-min lock on 3 failures
router.post('/verify', pinLimiter, validate(verifyPinSchema), PinController.verify);

// POST /api/v1/auth/pin/change - Changes PIN (validates current PIN first)
router.post('/change', pinLimiter, validate(changePinSchema), PinController.change);

module.exports = router;
