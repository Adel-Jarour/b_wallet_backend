-- ============================================================================
-- Migration 021: Compound Indexes for Cash Flow Analytics
-- B-Wallet FinTech Database Schema (Sprint 7)
-- ============================================================================
-- Adds optimized partial compound indexes to support sub-100ms analytical
-- aggregation queries for cash flow telemetry:
--   1. (sender_id, created_at DESC) for expense time-range aggregation
--   2. (receiver_id, created_at DESC) for income time-range aggregation
--   3. (sender_id, category) for expense category breakdowns
--
-- Only completed transactions are indexed to minimize index footprint
-- and maximize query scan efficiency.
-- ============================================================================

-- Fast range scan for user outflows/expenses
CREATE INDEX IF NOT EXISTS idx_transactions_sender_created_at
  ON public.transactions (sender_id, created_at DESC)
  WHERE status = 'COMPLETED';

-- Fast range scan for user inflows/income
CREATE INDEX IF NOT EXISTS idx_transactions_receiver_created_at
  ON public.transactions (receiver_id, created_at DESC)
  WHERE status = 'COMPLETED';

-- Fast lookup for categorized expense aggregations
CREATE INDEX IF NOT EXISTS idx_transactions_sender_category
  ON public.transactions (sender_id, category)
  WHERE status = 'COMPLETED';

COMMENT ON INDEX idx_transactions_sender_created_at IS
  'Optimizes chronological date-range scans for user outgoing transactions in cash flow analytics.';
COMMENT ON INDEX idx_transactions_receiver_created_at IS
  'Optimizes chronological date-range scans for user incoming transactions in cash flow analytics.';
