-- ============================================================================
-- Migration 005: Create Saved Cards Table
-- B-Wallet FinTech Database Schema
-- ============================================================================
-- Stores tokenized payment method references. PCI-DSS Level 4 compliant:
-- ONLY stores non-sensitive data (token references, brand, last4, expiry).
-- Raw card numbers (PAN) and CVC codes are NEVER stored.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.saved_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Card owner
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Payment gateway references (tokens, not raw card data)
  gateway_customer_id VARCHAR(255),
  gateway_payment_method_id VARCHAR(255) NOT NULL,

  -- Non-sensitive card display data
  brand VARCHAR(20) NOT NULL
    CHECK (brand IN ('Visa', 'MasterCard', 'Amex', 'Discover', 'UnionPay', 'JCB', 'Other')),
  last4 CHAR(4) NOT NULL
    CHECK (last4 ~ '^\d{4}$'),

  -- Card expiration
  expiry_month INTEGER NOT NULL,
  expiry_year INTEGER NOT NULL,

  -- Default payment method flag
  is_default BOOLEAN NOT NULL DEFAULT FALSE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ========================================================================
  -- Constraints
  -- ========================================================================

  -- Expiry month must be valid (1-12)
  CONSTRAINT chk_saved_cards_expiry_month CHECK (expiry_month BETWEEN 1 AND 12),

  -- Expiry year must be 2026 or later
  CONSTRAINT chk_saved_cards_expiry_year CHECK (expiry_year >= 2026)
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Fast card lookup by user
CREATE INDEX IF NOT EXISTS idx_saved_cards_user_id
  ON public.saved_cards(user_id);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.saved_cards IS 'Tokenized payment method storage. PCI-DSS compliant: only stores gateway tokens, brand, last4, and expiry.';
COMMENT ON COLUMN public.saved_cards.gateway_payment_method_id IS 'Payment gateway token reference. NEVER a raw card number.';
