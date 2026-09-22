-- ============================================================================
-- Migration 016: System Fee Wallet and Used Transaction Tickets
-- B-Wallet FinTech Database Schema (Sprint 4 Hardening)
-- ============================================================================
-- 1. System Fee Account Architecture:
--    - Enables public.wallets to hold system-level wallets (e.g. SYSTEM_FEE).
--    - user_id is made nullable for system accounts.
--    - A check constraint and partial unique index ensures exactly one SYSTEM_FEE
--      wallet per currency.
--    - Seeds the default USD platform fee wallet with a fixed deterministic UUID.
--
-- 2. Used Transaction Tickets Table:
--    - Tracks consumed transaction ticket JTIs to guarantee single-use authorization.
--    - Prevents ticket replay attacks where a ticket is reused within its 5-min TTL.
-- ============================================================================

-- 1. Wallets table alterations for system fee account
ALTER TABLE public.wallets ALTER COLUMN user_id DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.wallets
    ADD COLUMN wallet_type VARCHAR(20) NOT NULL DEFAULT 'USER'
    CHECK (wallet_type IN ('USER', 'SYSTEM_FEE'));
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

-- Partial unique index: each currency can have at most one active SYSTEM_FEE wallet
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallets_system_fee_currency
  ON public.wallets(currency)
  WHERE wallet_type = 'SYSTEM_FEE';

-- Seed the USD platform fee wallet (fixed well-known UUID: 00000000-0000-0000-0000-000000000001)
INSERT INTO public.wallets (
  id,
  user_id,
  currency,
  balance,
  status,
  wallet_type
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  NULL,
  'USD',
  0.00,
  'ACTIVE',
  'SYSTEM_FEE'
)
ON CONFLICT (id) DO UPDATE
SET wallet_type = 'SYSTEM_FEE', status = 'ACTIVE';

-- 2. Create used_transaction_tickets table
CREATE TABLE IF NOT EXISTS public.used_transaction_tickets (
  ticket_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  purpose VARCHAR(50) NOT NULL DEFAULT 'TRANSACTION',
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Indexes for used tickets
CREATE INDEX IF NOT EXISTS idx_used_tickets_user_id
  ON public.used_transaction_tickets(user_id);

CREATE INDEX IF NOT EXISTS idx_used_tickets_expires_at
  ON public.used_transaction_tickets(expires_at);

-- RLS on used_transaction_tickets (only accessible via service_role backend)
ALTER TABLE public.used_transaction_tickets ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.used_transaction_tickets IS
  'Tracks consumed cryptographic transaction tickets (JTI) to enforce single-use authorization and prevent replay attacks.';
