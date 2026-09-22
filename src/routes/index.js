const express = require('express');
const healthRoutes = require('./health.routes');
const ApiError = require('../utils/ApiError');

const router = express.Router();

// Mount root health route
router.use('/health', healthRoutes);

// API v1 root
const v1Router = express.Router();

const authRoutes = require('./auth.routes');
const pinRoutes = require('./pin.routes');
const profileRoutes = require('./profile.routes');
const walletRoutes = require('./wallet.routes');
const transferRoutes = require('./transfer.routes');
const paymentRequestRoutes = require('./payment_request.routes');
const cardRoutes = require('./card.routes');
const topupRoutes = require('./topup.routes');
const webhookRoutes = require('./webhook.routes');

// v1 health check alias: /api/v1/health
v1Router.use('/health', healthRoutes);

// Authentication & Session routes
v1Router.use('/auth', authRoutes);

// Transaction PIN routes: /api/v1/auth/pin
v1Router.use('/auth/pin', pinRoutes);

// User Profile routes: /api/v1/profile
v1Router.use('/profile', profileRoutes);

// Digital Wallet & Ledger routes: /api/v1/wallets
v1Router.use('/wallets', walletRoutes);

// P2P Fund Transfer routes: /api/v1/transfers
v1Router.use('/transfers', transferRoutes);

// Payment Request & Invoicing routes: /api/v1/requests
v1Router.use('/requests', paymentRequestRoutes);

// Saved Cards: /api/v1/cards
v1Router.use('/cards', cardRoutes);

// Top-Up: /api/v1/top-up
v1Router.use('/top-up', topupRoutes);

// Payment Gateway Webhooks: /api/v1/webhooks
v1Router.use('/webhooks', webhookRoutes);

// Cash Flow Analytics: /api/v1/analytics
const analyticsRoutes = require('./analytics.routes');
v1Router.use('/analytics', analyticsRoutes);

// Real-Time Social Messaging & Conversations: /api/v1/conversations
const conversationRoutes = require('./conversation.routes');
v1Router.use('/conversations', conversationRoutes);

// Notification Center: /api/v1/notifications
const notificationRoutes = require('./notification.routes');
v1Router.use('/notifications', notificationRoutes);

// User Device Tokens: /api/v1/users
const userRoutes = require('./user.routes');
v1Router.use('/users', userRoutes);

// Mount /api/v1
router.use('/api/v1', v1Router);

// Catch-all for undefined routes
router.use('*', (req, res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
});

module.exports = router;
