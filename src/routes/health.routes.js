const express = require('express');
const { env } = require('../config/env');
const { checkSupabaseHealth } = require('../config/supabase');

const router = express.Router();

/**
 * @route   GET /health
 * @desc    Comprehensive system health check (API status, uptime, memory, Supabase connectivity)
 * @access  Public
 */
router.get('/', async (req, res) => {
  const memory = process.memoryUsage();

  // Run reachability check on Supabase
  const supabaseHealth = await checkSupabaseHealth();

  const isSupabaseConnected = supabaseHealth.healthy;
  const overallStatus = isSupabaseConnected ? 'UP' : 'DEGRADED';

  const responsePayload = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: `${process.uptime().toFixed(2)}s`,
    environment: env.NODE_ENV,
    correlationId: req.correlationId,
    services: {
      api: 'HEALTHY',
      supabase: isSupabaseConnected ? 'CONNECTED' : 'DISCONNECTED'
    },
    diagnostics: {
      supabaseLatencyMs: supabaseHealth.latencyMs,
      supabaseDetails: supabaseHealth.details || null,
      supabaseError: supabaseHealth.error || null
    },
    system: {
      nodeVersion: process.version,
      memoryUsageMb: {
        rss: (memory.rss / 1024 / 1024).toFixed(2),
        heapUsed: (memory.heapUsed / 1024 / 1024).toFixed(2),
        heapTotal: (memory.heapTotal / 1024 / 1024).toFixed(2)
      }
    }
  };

  // If degraded due to Supabase, respond with 200 during local dev/Sprint 0 so health monitoring works
  res.status(200).json(responsePayload);
});

module.exports = router;
