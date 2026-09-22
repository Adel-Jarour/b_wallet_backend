-- ============================================================================
-- Migration 003: Create Wallets Table
-- B-Wallet FinTech Database Schema
-- ============================================================================
-- The wallets table holds the current spendable balance per user per currency.
-- Financial precision is enforced with NUMERIC(15,2) (fixed-point arithmetic).
-- CHECK constraints prevent negative balances at the database level.
-- ON DELETE RESTRICT prevents deletion of profiles that hold wallets.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Owner reference (ON DELETE RESTRICT: cannot delete profile with active wallet)
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,

  -- Currency code (ISO 4217, e.g., 'USD')
  currency CHAR(3) NOT NULL DEFAULT 'USD',

  -- Current spendable balance with fixed-point precision
  -- NUMERIC(15,2) supports values up to 9,999,999,999,999.99
  balance NUMERIC(15,2) NOT NULL DEFAULT 0.00,

  -- Wallet lifecycle status
  status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED')),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ========================================================================
  -- Constraints
  -- ========================================================================

  -- Prevent negative balances at the database level
  CONSTRAINT chk_wallets_balance_non_negative CHECK (balance >= 0.00),

  -- Each user can only have one wallet per currency
  CONSTRAINT uq_wallets_user_currency UNIQUE (user_id, currency),

  -- Currency must be exactly 3 characters
  CONSTRAINT chk_wallets_currency_length CHECK (char_length(currency) = 3)
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Fast wallet lookup by user
CREATE INDEX IF NOT EXISTS idx_wallets_user_id
  ON public.wallets(user_id);

-- ============================================================================
-- Auto-update updated_at timestamp trigger
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_wallets_updated_at ON public.wallets;
CREATE TRIGGER trigger_wallets_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.wallets IS 'Digital wallet holding spendable balance per user per currency. NUMERIC(15,2) for financial precision.';
COMMENT ON COLUMN public.wallets.balance IS 'Current spendable balance. Must be >= 0.00. Only modifiable via server-side atomic procedures.';
COMMENT ON COLUMN public.wallets.status IS 'Wallet lifecycle: ACTIVE (operational), FROZEN (temporarily blocked), CLOSED (permanently deactivated).';
