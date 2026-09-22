const WalletService = require('../services/wallet.service');

class WalletController {
  /**
   * GET /api/v1/wallets/me
   * Retrieves the authenticated user's primary wallet.
   */
  static async getMyWallet(req, res, next) {
    try {
      const wallet = await WalletService.getWalletByUserId(req.userId);
      res.status(200).json({
        success: true,
        message: 'Wallet retrieved successfully',
        data: {
          wallet
        }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/wallets/me/ledger
   * Retrieves paginated double-entry ledger entries for the authenticated user's wallet.
   */
  static async getMyLedger(req, res, next) {
    try {
      const result = await WalletService.getLedgerEntries(req.userId, req.query);
      res.status(200).json({
        success: true,
        message: 'Ledger entries retrieved successfully',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/wallets/me/audit
   * Runs real-time balance integrity check against ledger entries.
   */
  static async auditMyWallet(req, res, next) {
    try {
      const audit = await WalletService.auditWalletIntegrity(req.userId);
      res.status(200).json({
        success: true,
        message: audit.isValid
          ? 'Wallet balance integrity verified successfully'
          : 'Wallet balance integrity discrepancy detected',
        data: audit
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = WalletController;
