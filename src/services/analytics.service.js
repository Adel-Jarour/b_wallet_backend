const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

class AnalyticsService {
  /**
   * Retrieves aggregated cash flow analytics for an authenticated user.
   *
   * @param {string} userId - Authenticated user UUID
   * @param {Object} params
   * @param {'weekly'|'monthly'|'yearly'} [params.period='monthly'] - Aggregation period
   * @param {string} [params.currency='USD'] - ISO 4217 currency code
   * @param {string} [params.start_date] - Optional start date ISO string
   * @param {string} [params.end_date] - Optional end date ISO string
   * @returns {Promise<Object>} Aggregated cash flow telemetry
   */
  static async getCashFlow(userId, { period = 'monthly', currency = 'USD', start_date = null, end_date = null }) {
    const { data, error } = await supabaseAdmin.rpc('get_cash_flow_analytics', {
      p_user_id: userId,
      p_period: period,
      p_start_date: start_date,
      p_end_date: end_date,
      p_currency: currency
    });

    if (error) {
      logger.error({ err: error.message, userId, period, currency }, 'Failed to compute cash flow analytics');
      throw ApiError.internal(`Failed to retrieve cash flow analytics: ${error.message}`);
    }

    if (!data) {
      throw ApiError.internal('Analytics procedure returned empty result');
    }

    const summary = data.summary || {};
    const formattedSummary = {
      total_income: parseFloat(Number(summary.total_income || 0).toFixed(2)),
      total_expense: parseFloat(Number(summary.total_expense || 0).toFixed(2)),
      net_savings: parseFloat(Number(summary.net_savings || 0).toFixed(2)),
      net_savings_ratio: parseFloat(Number(summary.net_savings_ratio || 0).toFixed(2))
    };

    const categories = (data.categories || []).map(c => ({
      category: c.category,
      total_amount: parseFloat(Number(c.total_amount || 0).toFixed(2)),
      percentage: parseFloat(Number(c.percentage || 0).toFixed(2)),
      transaction_count: c.transaction_count || 0
    }));

    const chartData = (data.chart_data || []).map(d => ({
      label: d.label,
      date: d.date || null,
      start_date: d.start_date || null,
      end_date: d.end_date || null,
      income: parseFloat(Number(d.income || 0).toFixed(2)),
      expense: parseFloat(Number(d.expense || 0).toFixed(2)),
      net: parseFloat(Number(d.net || 0).toFixed(2))
    }));

    return {
      period: data.period,
      currency: data.currency,
      start_date: data.start_date,
      end_date: data.end_date,
      summary: formattedSummary,
      categories,
      chart_data: chartData
    };
  }
}

module.exports = AnalyticsService;
