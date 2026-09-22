const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const { formatMoney, equals } = require('../utils/money.util');

class WalletService {
  /**
   * Retrieves the user's wallet by user ID and currency (defaults to 'USD').
   * Enforces NUMERIC(15,2) string formatting for spendable balance.
   *
   * @param {string} userId - Authenticated user UUID
   * @param {string} [currency='USD'] - Currency code
   * @returns {Promise<Object>} Sanitized wallet object
   */
  static async getWalletByUserId(userId, currency = 'USD') {
    const { data: wallet, error } = await supabaseAdmin
      .from('wallets')
      .select('id, user_id, currency, balance, status, created_at, updated_at')
      .eq('user_id', userId)
      .eq('currency', currency.toUpperCase())
      .single();

    if (error || !wallet) {
      logger.warn({ userId, currency }, 'Wallet not found for user');
      throw ApiError.notFound(`No ${currency} wallet found for this user`, 'WALLET_NOT_FOUND');
    }

    return {
      id: wallet.id,
      userId: wallet.user_id,
      currency: wallet.currency,
      balance: formatMoney(wallet.balance),
      status: wallet.status,
      createdAt: wallet.created_at,
      updatedAt: wallet.updated_at
    };
  }

  /**
   * Retrieves paginated double-entry ledger records for the user's wallet.
   * Ensures deterministic chronological ordering: created_at DESC, id DESC.
   *
   * @param {string} userId - Authenticated user UUID
   * @param {Object} query - Query parameters (page, limit, direction)
   * @returns {Promise<Object>} Paginated ledger entries and metadata
   */
  static async getLedgerEntries(userId, query = {}) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const direction = query.direction;

    // 1. Get user's wallet
    const wallet = await this.getWalletByUserId(userId);

    // 2. Build query with exact count
    let dbQuery = supabaseAdmin
      .from('ledger_entries')
      .select(
        'id, transaction_id, wallet_id, direction, amount, created_at, transactions(id, transaction_reference, type, status, category, note, created_at)',
        { count: 'exact' }
      )
      .eq('wallet_id', wallet.id);

    if (direction) {
      dbQuery = dbQuery.eq('direction', direction);
    }

    // 3. Deterministic pagination ordering
    const offset = (page - 1) * limit;
    dbQuery = dbQuery
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: entries, error, count } = await dbQuery;

    if (error) {
      logger.error({ err: error.message, walletId: wallet.id }, 'Failed to fetch ledger entries');
      throw ApiError.internal('Failed to retrieve ledger entries', 'LEDGER_FETCH_ERROR');
    }

    // 4. Format entries with exact financial precision
    const formattedEntries = (entries || []).map(entry => ({
      id: entry.id,
      transactionId: entry.transaction_id,
      walletId: entry.wallet_id,
      direction: entry.direction,
      amount: formatMoney(entry.amount),
      createdAt: entry.created_at,
      transaction: entry.transactions ? {
        id: entry.transactions.id,
        reference: entry.transactions.transaction_reference,
        type: entry.transactions.type,
        status: entry.transactions.status,
        category: entry.transactions.category,
        note: entry.transactions.note,
        createdAt: entry.transactions.created_at
      } : null
    }));

    const totalItems = count !== null && count !== undefined ? count : formattedEntries.length;
    const totalPages = Math.ceil(totalItems / limit) || (totalItems === 0 ? 0 : 1);

    return {
      wallet: {
        id: wallet.id,
        currency: wallet.currency,
        balance: wallet.balance
      },
      entries: formattedEntries,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    };
  }

  /**
   * Executes a real-time mathematical audit of the wallet balance against
   * its immutable double-entry ledger entries.
   *
   * In accordance with NFR-INT-003 and FinTech audit regulations:
   * - Computes SUM(CREDIT) - SUM(DEBIT)
   * - Compares with current wallet balance
   * - Detects any discrepancies WITHOUT silently mutating or repairing records
   *
   * @param {string} userId - Authenticated user UUID
   * @param {string} [currency='USD'] - Currency code
   * @returns {Promise<Object>} Audit report
   */
  static async auditWalletIntegrity(userId, currency = 'USD') {
    const wallet = await this.getWalletByUserId(userId, currency);

    // Call PostgreSQL stored procedure verify_wallet_integrity
    const { data, error } = await supabaseAdmin.rpc('verify_wallet_integrity', {
      p_wallet_id: wallet.id
    });

    if (error || !data || data.length === 0) {
      logger.error({ err: error ? error.message : 'No data returned', walletId: wallet.id }, 'RPC verify_wallet_integrity failed');
      throw ApiError.internal('Failed to audit wallet balance integrity', 'AUDIT_EXECUTION_ERROR');
    }

    const row = data[0];
    const currentBalance = formatMoney(row.current_balance);
    const calculatedBalance = formatMoney(row.calculated_balance);
    const totalCredits = formatMoney(row.total_credits);
    const totalDebits = formatMoney(row.total_debits);
    const discrepancy = formatMoney(row.discrepancy);
    const isValid = Boolean(row.is_valid) && equals(currentBalance, calculatedBalance);

    if (!isValid) {
      logger.fatal(
        {
          walletId: wallet.id,
          userId,
          currentBalance,
          calculatedBalance,
          discrepancy
        },
        'CRITICAL_FINANCIAL_DISCREPANCY: Wallet balance does not match ledger sum!'
      );
    }

    return {
      walletId: row.wallet_id,
      currency: row.currency,
      currentBalance,
      calculatedBalance,
      totalCredits,
      totalDebits,
      entryCount: Number(row.entry_count),
      discrepancy,
      isValid,
      status: isValid ? 'HEALTHY' : 'DISCREPANCY_DETECTED',
      auditedAt: new Date().toISOString()
    };
  }
}

module.exports = WalletService;
