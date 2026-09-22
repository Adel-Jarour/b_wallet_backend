-- ============================================================================
-- Migration 013: Create verify_wallet_integrity RPC Function
-- B-Wallet FinTech Database Schema (Sprint 3)
-- ============================================================================
-- Performs a real-time mathematical audit of a wallet's spendable balance
-- against its immutable double-entry ledger records.
--
-- Audit formula:
--   Calculated Balance = SUM(CREDIT) - SUM(DEBIT)
--   Discrepancy = Current Balance - Calculated Balance
--   Valid = (Discrepancy = 0.00)
--
-- In accordance with NFR-INT-003 and FinTech audit standards:
-- - Fixed-point NUMERIC(15,2) arithmetic is enforced throughout.
-- - No data is mutated or silently repaired.
-- - Read-only integrity verification.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.verify_wallet_integrity(p_wallet_id UUID)
RETURNS TABLE (
  wallet_id UUID,
  currency CHAR(3),
  current_balance NUMERIC(15,2),
  calculated_balance NUMERIC(15,2),
  total_credits NUMERIC(15,2),
  total_debits NUMERIC(15,2),
  entry_count INT,
  discrepancy NUMERIC(15,2),
  is_valid BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet RECORD;
  v_credits NUMERIC(15,2);
  v_debits NUMERIC(15,2);
  v_entries INT;
  v_calc NUMERIC(15,2);
  v_disc NUMERIC(15,2);
  v_valid BOOLEAN;
BEGIN
  -- 1. Fetch wallet details
  SELECT w.id, w.currency, w.balance, w.status
  INTO v_wallet
  FROM public.wallets w
  WHERE w.id = p_wallet_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet with ID % not found', p_wallet_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. Aggregate ledger credits and debits using NUMERIC(15,2)
  SELECT
    COALESCE(SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE 0.00 END), 0.00)::NUMERIC(15,2),
    COALESCE(SUM(CASE WHEN le.direction = 'DEBIT' THEN le.amount ELSE 0.00 END), 0.00)::NUMERIC(15,2),
    COUNT(le.id)::INT
  INTO v_credits, v_debits, v_entries
  FROM public.ledger_entries le
  WHERE le.wallet_id = p_wallet_id;

  -- 3. Calculate expected balance and discrepancy
  v_calc := (v_credits - v_debits)::NUMERIC(15,2);
  v_disc := (v_wallet.balance - v_calc)::NUMERIC(15,2);
  v_valid := (v_disc = 0.00);

  -- 4. Return audit record
  RETURN QUERY
  SELECT
    v_wallet.id,
    v_wallet.currency,
    v_wallet.balance,
    v_calc,
    v_credits,
    v_debits,
    v_entries,
    v_disc,
    v_valid;
END;
$$;

COMMENT ON FUNCTION public.verify_wallet_integrity(UUID) IS 
  'Audits wallet balance against double-entry ledger entries. Computes discrepancy and returns validation status without mutating state.';
