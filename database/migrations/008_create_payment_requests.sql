-- ============================================================================
-- Migration 008: Create Payment Requests Table
-- B-Wallet FinTech Database Schema
-- ============================================================================
-- Dedicated table for payment request tickets (per Architectural Decision 2).
-- Separates pending invoices from completed financial ledger records.
-- When a request is settled, a completed record is created in transactions
-- and the payment_requests.status transitions to COMPLETED.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.payment_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- The user who is requesting money
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,

  -- The user who is asked to pay
  payer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,

  -- Requested amount with fixed-point precision
  amount NUMERIC(15,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',

  -- Categorization (mirrors transaction categories)
  category VARCHAR(50),

  -- Optional note/reason for the request
  note TEXT,

  -- Request lifecycle status
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'COMPLETED', 'DECLINED', 'CANCELLED')),

  -- Link to the settlement transaction (set when status = COMPLETED)
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE RESTRICT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ========================================================================
  -- Constraints
  -- ========================================================================

  -- Amount must be strictly positive
  CONSTRAINT chk_payment_requests_amount_positive CHECK (amount > 0),

  -- Currency must be exactly 3 characters
  CONSTRAINT chk_payment_requests_currency_length CHECK (char_length(currency) = 3),

  -- Requester cannot request money from themselves
  CONSTRAINT chk_payment_requests_different_users CHECK (requester_id <> payer_id)
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Fast lookup by requester (outgoing requests)
CREATE INDEX IF NOT EXISTS idx_payment_requests_requester_id
  ON public.payment_requests(requester_id);

-- Fast lookup by payer (incoming requests)
CREATE INDEX IF NOT EXISTS idx_payment_requests_payer_id
  ON public.payment_requests(payer_id);

-- Filter by status (e.g., "show me all PENDING requests")
CREATE INDEX IF NOT EXISTS idx_payment_requests_status
  ON public.payment_requests(status);

-- ============================================================================
-- Auto-update updated_at timestamp trigger
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_payment_requests_updated_at ON public.payment_requests;
CREATE TRIGGER trigger_payment_requests_updated_at
  BEFORE UPDATE ON public.payment_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.payment_requests IS 'Payment request tickets. Separated from transactions to keep the ledger clean (Decision 2).';
COMMENT ON COLUMN public.payment_requests.transaction_id IS 'FK to the settlement transaction created when the request is paid.';
