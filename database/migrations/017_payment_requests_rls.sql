-- ============================================================================
-- Migration 017: Row Level Security for payment_requests
-- B-Wallet FinTech Database Schema (Sprint 5)
-- ============================================================================
-- Enforces owner-only access on the payment_requests table.
--
-- Policy Design:
--   SELECT : requester OR payer can view the request (both parties)
--   INSERT : authenticated user can only create requests as requester
--   UPDATE : blocked for direct client access; all mutations happen through
--            the settle_payment_request_atomic RPC (SECURITY DEFINER) or
--            the service_role backend (decline/cancel endpoints).
--   DELETE : blocked entirely (financial audit trail must be preserved).
-- ============================================================================

-- Enable RLS
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- SELECT: Both requester and payer can view the request
-- ============================================================================
DROP POLICY IF EXISTS "payment_requests_select_own" ON public.payment_requests;
CREATE POLICY "payment_requests_select_own"
  ON public.payment_requests
  FOR SELECT
  USING (
    auth.uid() = requester_id
    OR auth.uid() = payer_id
  );

-- ============================================================================
-- INSERT: Authenticated user may only insert requests where they are requester
-- ============================================================================
DROP POLICY IF EXISTS "payment_requests_insert_as_requester" ON public.payment_requests;
CREATE POLICY "payment_requests_insert_as_requester"
  ON public.payment_requests
  FOR INSERT
  WITH CHECK (
    auth.uid() = requester_id
  );

-- ============================================================================
-- UPDATE: Blocked at the client level.
--   All status transitions are performed by the service_role key via:
--     - settle_payment_request_atomic RPC (SECURITY DEFINER)
--     - PaymentRequestService.declineRequest / cancelRequest (service_role)
--   Direct client UPDATE attempts are rejected.
-- ============================================================================
DROP POLICY IF EXISTS "payment_requests_update_blocked" ON public.payment_requests;
CREATE POLICY "payment_requests_update_blocked"
  ON public.payment_requests
  FOR UPDATE
  USING (false);

-- ============================================================================
-- DELETE: Blocked entirely — financial records must be immutable.
-- ============================================================================
DROP POLICY IF EXISTS "payment_requests_delete_blocked" ON public.payment_requests;
CREATE POLICY "payment_requests_delete_blocked"
  ON public.payment_requests
  FOR DELETE
  USING (false);

COMMENT ON TABLE public.payment_requests IS
  'Payment request tickets. RLS enforces that only requester and payer can read. All writes go through service_role.';
