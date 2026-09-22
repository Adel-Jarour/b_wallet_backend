-- ============================================================================
-- Migration 004: Create Transactions and Ledger Entries Tables
-- B-Wallet FinTech Database Schema
-- ============================================================================
-- Transactions: Immutable financial event headers (append-only design).
-- Ledger Entries: Double-entry accounting records where every financial
-- transaction produces exactly one DEBIT and one CREDIT entry that must
-- balance to zero net difference.
--
-- Design Principle (NFR-INT-004): Transaction records are IMMUTABLE.
-- Corrections are modeled as new reversing transactions, never as UPDATEs.
-- ============================================================================

-- ============================================================================
-- Transactions Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Unique human-readable reference (e.g., "TXN-20260912-XXXX")
  transaction_reference VARCHAR(50) NOT NULL UNIQUE,

  -- Participants (nullable for TOP_UP where there's no sender)
  sender_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  receiver_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,

  -- Financial amounts with fixed-point precision
  amount NUMERIC(15,2) NOT NULL,
  fee NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  currency CHAR(3) NOT NULL DEFAULT 'USD',

  -- Transaction classification
  type transaction_type NOT NULL,
  status transaction_status NOT NULL DEFAULT 'PENDING',

  -- Categorization for analytics (e.g., Food, Expense, Property, Hobby, Entertainment)
  category VARCHAR(50),

  -- Optional user note/memo
  note TEXT,

  -- Idempotency key for duplicate prevention (NFR-INT-002)
  idempotency_key UUID,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,

  -- ========================================================================
  -- Constraints
  -- ========================================================================

  -- Transaction amount must be strictly positive
  CONSTRAINT chk_transactions_amount_positive CHECK (amount > 0),

  -- Fee must be non-negative
  CONSTRAINT chk_transactions_fee_non_negative CHECK (fee >= 0),

  -- Currency must be exactly 3 characters
  CONSTRAINT chk_transactions_currency_length CHECK (char_length(currency) = 3),

  -- Idempotency key uniqueness (prevents duplicate financial operations)
  CONSTRAINT uq_transactions_idempotency_key UNIQUE (idempotency_key)
);

-- ============================================================================
-- Ledger Entries Table (Double-Entry Bookkeeping)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Parent transaction that generated this entry
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,

  -- Target wallet affected by this entry
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,

  -- Direction: DEBIT (outflow) or CREDIT (inflow)
  direction entry_direction NOT NULL,

  -- Entry amount with fixed-point precision
  amount NUMERIC(15,2) NOT NULL,

  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- ========================================================================
  -- Constraints
  -- ========================================================================

  -- Ledger entry amount must be strictly positive
  CONSTRAINT chk_ledger_entries_amount_positive CHECK (amount > 0)
);

-- ============================================================================
-- Indexes for Transactions
-- ============================================================================

-- Fast lookup by transaction reference
CREATE INDEX IF NOT EXISTS idx_transactions_reference
  ON public.transactions(transaction_reference);

-- Fast lookup by sender
CREATE INDEX IF NOT EXISTS idx_transactions_sender_id
  ON public.transactions(sender_id)
  WHERE sender_id IS NOT NULL;

-- Fast lookup by receiver
CREATE INDEX IF NOT EXISTS idx_transactions_receiver_id
  ON public.transactions(receiver_id)
  WHERE receiver_id IS NOT NULL;

-- Chronological ordering and range queries
CREATE INDEX IF NOT EXISTS idx_transactions_created_at
  ON public.transactions(created_at DESC);

-- Idempotency key lookup
CREATE INDEX IF NOT EXISTS idx_transactions_idempotency_key
  ON public.transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ============================================================================
-- Indexes for Ledger Entries
-- ============================================================================

-- Fast lookup by transaction (for audit and integrity checks)
CREATE INDEX IF NOT EXISTS idx_ledger_entries_transaction_id
  ON public.ledger_entries(transaction_id);

-- Fast lookup by wallet (for balance verification and history)
CREATE INDEX IF NOT EXISTS idx_ledger_entries_wallet_id
  ON public.ledger_entries(wallet_id);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.transactions IS 'Immutable financial transaction headers. Append-only design — corrections modeled as reversing transactions.';
COMMENT ON COLUMN public.transactions.idempotency_key IS 'Client-generated UUIDv4 preventing duplicate debits (NFR-INT-002).';
COMMENT ON TABLE public.ledger_entries IS 'Double-entry accounting ledger. Every transaction produces offsetting DEBIT and CREDIT entries.';
COMMENT ON COLUMN public.ledger_entries.direction IS 'DEBIT = money leaving wallet, CREDIT = money entering wallet.';
