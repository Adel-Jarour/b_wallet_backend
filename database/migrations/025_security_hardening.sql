-- ============================================================================
-- Migration 025: Security Hardening & Immutable Financial Ledger Triggers
-- B-Wallet FinTech Database Schema - Sprint 9
-- ============================================================================
-- 1. Financial Ledger Immutability (NFR-INT-004):
--    Creates a trigger that strictly prevents any UPDATE or DELETE statement
--    on public.transactions and public.ledger_entries.
-- 2. SECURITY DEFINER Hardening:
--    Explicitly revokes EXECUTE privileges from PUBLIC, anon, authenticated
--    on record_pin_attempt and verify_wallet_integrity, restricting execution
--    strictly to service_role.
-- ============================================================================

-- ============================================================================
-- 1. Ledger Immutability Trigger Function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_financial_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Financial audit records are immutable: % operations are strictly prohibited on % (NFR-INT-004)',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501'; -- insufficient_privilege
END;
$$;

COMMENT ON FUNCTION public.prevent_financial_mutation() IS
  'Enforces ledger immutability (NFR-INT-004): blocks all UPDATE and DELETE mutations on transactions and ledger_entries.';

-- Trigger on public.transactions
DROP TRIGGER IF EXISTS trigger_transactions_immutable ON public.transactions;
CREATE TRIGGER trigger_transactions_immutable
  BEFORE UPDATE OR DELETE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_financial_mutation();

-- Trigger on public.ledger_entries
DROP TRIGGER IF EXISTS trigger_ledger_entries_immutable ON public.ledger_entries;
CREATE TRIGGER trigger_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_financial_mutation();

-- ============================================================================
-- 2. SECURITY DEFINER Execution Privileges Hardening
-- ============================================================================

-- Revoke and re-grant on public.record_pin_attempt(UUID, BOOLEAN)
REVOKE ALL ON FUNCTION public.record_pin_attempt(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pin_attempt(UUID, BOOLEAN) TO service_role;

-- Revoke and re-grant on public.verify_wallet_integrity(UUID)
REVOKE ALL ON FUNCTION public.verify_wallet_integrity(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_wallet_integrity(UUID) TO service_role;
