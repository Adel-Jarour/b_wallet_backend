-- ============================================================================
-- Migration 019: Saved Cards RLS and System Settlement Wallet
-- B-Wallet FinTech Database Schema (Sprint 6)
-- ============================================================================
-- 1. SAVED CARDS RLS:
--    - SELECT: Users can only read their own tokenized payment methods.
--    - UPDATE: Users can update their own cards (e.g. toggle is_default).
--    - DELETE: Users can remove their own cards.
--    - INSERT: Direct client inserts are blocked (cards must be saved through
--              the backend service after gateway tokenization).
--
-- 2. SYSTEM SETTLEMENT WALLET:
--    - Expands wallets.wallet_type to include 'SYSTEM_SETTLEMENT'.
--    - Seeds the default USD platform settlement wallet (00000000-0000-0000-0000-000000000002)
--      to maintain symmetrical double-entry ledger accounting on top-ups.
-- ============================================================================

-- Enable RLS on saved_cards
ALTER TABLE public.saved_cards ENABLE ROW LEVEL SECURITY;

-- SELECT policy
DROP POLICY IF EXISTS "saved_cards_select_own" ON public.saved_cards;
CREATE POLICY "saved_cards_select_own"
  ON public.saved_cards
  FOR SELECT
  USING (auth.uid() = user_id);

-- DELETE policy
DROP POLICY IF EXISTS "saved_cards_delete_own" ON public.saved_cards;
CREATE POLICY "saved_cards_delete_own"
  ON public.saved_cards
  FOR DELETE
  USING (auth.uid() = user_id);

-- UPDATE policy (e.g. toggle is_default)
DROP POLICY IF EXISTS "saved_cards_update_own" ON public.saved_cards;
CREATE POLICY "saved_cards_update_own"
  ON public.saved_cards
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- INSERT blocked for direct client mutations; only service_role creates
DROP POLICY IF EXISTS "saved_cards_insert_blocked" ON public.saved_cards;
CREATE POLICY "saved_cards_insert_blocked"
  ON public.saved_cards
  FOR INSERT
  WITH CHECK (false);

-- ============================================================================
-- Update wallet_type check constraint to include SYSTEM_SETTLEMENT
-- ============================================================================
DO $$ 
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT conname 
    FROM pg_constraint 
    WHERE conrelid = 'public.wallets'::regclass 
      AND contype = 'c' 
      AND pg_get_constraintdef(oid) LIKE '%wallet_type%'
  ) LOOP
    EXECUTE 'ALTER TABLE public.wallets DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE public.wallets
  ADD CONSTRAINT chk_wallets_wallet_type
  CHECK (wallet_type IN ('USER', 'SYSTEM_FEE', 'SYSTEM_SETTLEMENT'));

-- Allow SYSTEM_SETTLEMENT to track clearing balance while keeping strict >= 0 for USER and SYSTEM_FEE
ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS chk_wallets_balance_non_negative;
ALTER TABLE public.wallets
  ADD CONSTRAINT chk_wallets_balance_non_negative
  CHECK (wallet_type = 'SYSTEM_SETTLEMENT' OR balance >= 0.00);

-- Partial unique index for SYSTEM_SETTLEMENT
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallets_system_settlement_currency
  ON public.wallets(currency)
  WHERE wallet_type = 'SYSTEM_SETTLEMENT';

-- Seed USD platform settlement wallet (well-known UUID: 00000000-0000-0000-0000-000000000002)
INSERT INTO public.wallets (
  id,
  user_id,
  currency,
  balance,
  status,
  wallet_type
) VALUES (
  '00000000-0000-0000-0000-000000000002'::uuid,
  NULL,
  'USD',
  0.00,
  'ACTIVE',
  'SYSTEM_SETTLEMENT'
)
ON CONFLICT (id) DO UPDATE
SET wallet_type = 'SYSTEM_SETTLEMENT', status = 'ACTIVE';

