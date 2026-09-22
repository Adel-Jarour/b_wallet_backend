const express = require('express');
const { authenticateJwt } = require('../middlewares/auth');
const analyticsController = require('../controllers/analytics.controller');

const router = express.Router();

// All analytics endpoints require authenticated user JWT
router.use(authenticateJwt);

// GET /api/v1/analytics/cash-flow - Cash flow telemetry (FR-ANA-001..003)
router.get('/cash-flow', analyticsController.getCashFlow);

module.exports = router;
