const express = require('express');
const { authenticateJwt } = require('../middlewares/auth');
const topupController = require('../controllers/topup.controller');

const router = express.Router();

const { financialLimiter } = require('../middlewares/rateLimiter');

// Top-up intent initiation requires authenticated JWT
router.use(authenticateJwt);

// POST /api/v1/top-up/intent - Create payment intent
router.post('/intent', financialLimiter, topupController.createIntent);

module.exports = router;
