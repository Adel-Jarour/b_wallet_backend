const express = require('express');
const WalletController = require('../controllers/wallet.controller');
const { authenticateJwt } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const { ledgerPaginationSchema } = require('../schemas/wallet.schema');

const router = express.Router();

// All wallet routes require authenticated JWT identity
router.use(authenticateJwt);

/**
 * @route   GET /api/v1/wallets and /api/v1/wallets/me
 * @desc    Fetch authenticated user's primary wallet details
 * @access  Protected
 */
router.get('/', WalletController.getMyWallet);
router.get('/me', WalletController.getMyWallet);

/**
 * @route   GET /api/v1/wallets/me/ledger
 * @desc    Fetch paginated double-entry ledger entries for user's wallet
 * @access  Protected
 */
router.get(
  '/me/ledger',
  validate(ledgerPaginationSchema, 'query'),
  WalletController.getMyLedger
);

/**
 * @route   GET /api/v1/wallets/me/audit
 * @desc    Execute real-time balance integrity check against ledger entries
 * @access  Protected
 */
router.get('/me/audit', WalletController.auditMyWallet);

module.exports = router;
