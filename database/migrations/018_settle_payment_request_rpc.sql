-- ============================================================================
-- Migration 018: settle_payment_request_atomic PL/pgSQL Stored Procedure
-- B-Wallet FinTech Database Schema (Sprint 5)
-- ============================================================================
-- Atomically settles a PENDING payment request by:
--   1. Locking the payment_request row (FOR UPDATE) to prevent race conditions
--   2. Validating status = PENDING and payer ownership
--   3. Locking both wallets in deterministic order (deadlock prevention)
--   4. Executing the double-entry balance transfer (same ledger logic as transfer_funds_atomic)
--   5. Inserting the transaction record with type = 'REQUEST'
--   6. Inserting balanced ledger entries (DEBIT payer, CREDIT requester)
--   7. Updating payment_request: status = COMPLETED, transaction_id = <new tx id>
--   8. Returning a receipt JSONB
--
-- Security:
--   - SECURITY DEFINER + SET search_path = public, pg_temp
--   - REVOKE ALL FROM PUBLIC, anon, authenticated
--   - GRANT EXECUTE TO service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.settle_payment_request_atomic(
  p_request_id      UUID,           -- Payment request ID
  p_payer_id        UUID,           -- Authenticated payer user ID (from JWT)
  p_idempotency_key UUID,           -- Client UUIDv4 for deduplication
  p_tx_reference    VARCHAR(50)     -- Pre-generated unique transaction reference
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request         RECORD;
  v_payer_wallet    RECORD;
  v_requester_wallet RECORD;
  v_transaction_id  UUID;
  v_result          JSONB;
BEGIN
  -- ============================================================================
  -- 1. Lock the payment request row to prevent concurrent settlement
  -- ============================================================================
  SELECT * INTO v_request
  FROM public.payment_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment request not found: %', p_request_id
      USING ERRCODE = 'P0002';
  END IF;

  -- ============================================================================
  -- 2. Validate payer ownership
  -- ============================================================================
  IF v_request.payer_id != p_payer_id THEN
    RAISE EXCEPTION 'Authorization violation: caller (%) is not the payer for this request (%)',
      p_payer_id, p_request_id
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  -- ============================================================================
  -- 3. Validate status is PENDING
  -- ============================================================================
  IF v_request.status != 'PENDING' THEN
    RAISE EXCEPTION 'Payment request cannot be settled: current status is % (must be PENDING)',
      v_request.status
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================================================
  -- 4. Discover wallets (pre-lock)
  -- ============================================================================
  SELECT id, user_id, balance, status, currency INTO v_payer_wallet
  FROM public.wallets
  WHERE user_id = p_payer_id AND currency = v_request.currency;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payer wallet not found for currency %', v_request.currency
      USING ERRCODE = 'P0002';
  END IF;

  SELECT id, user_id, balance, status, currency INTO v_requester_wallet
  FROM public.wallets
  WHERE user_id = v_request.requester_id AND currency = v_request.currency;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requester wallet not found for currency %', v_request.currency
      USING ERRCODE = 'P0002';
  END IF;

  -- ============================================================================
  -- 5. Deterministic Row-Level Locking (Deadlock Prevention)
  --    Lock both wallets in strict ascending UUID order
  -- ============================================================================
  PERFORM 1 FROM public.wallets
  WHERE id IN (v_payer_wallet.id, v_requester_wallet.id)
  ORDER BY id
  FOR UPDATE;

  -- Re-read post-lock wallet state
  SELECT * INTO v_payer_wallet FROM public.wallets WHERE id = v_payer_wallet.id;
  SELECT * INTO v_requester_wallet FROM public.wallets WHERE id = v_requester_wallet.id;

  -- ============================================================================
  -- 6. Validate wallet statuses and sufficient funds
  -- ============================================================================
  IF v_payer_wallet.status != 'ACTIVE' THEN
    RAISE EXCEPTION 'Payer wallet is not ACTIVE (status: %)', v_payer_wallet.status
      USING ERRCODE = 'P0004';
  END IF;

  IF v_requester_wallet.status != 'ACTIVE' THEN
    RAISE EXCEPTION 'Requester wallet is not ACTIVE (status: %)', v_requester_wallet.status
      USING ERRCODE = 'P0004';
  END IF;

  IF v_payer_wallet.balance < v_request.amount THEN
    RAISE EXCEPTION 'Insufficient funds: payer balance % < requested %',
      v_payer_wallet.balance, v_request.amount
      USING ERRCODE = 'P0005';
  END IF;

  -- ============================================================================
  -- 7. Execute balance updates
  -- ============================================================================
  -- Debit payer
  UPDATE public.wallets
  SET balance = balance - v_request.amount,
      updated_at = NOW()
  WHERE id = v_payer_wallet.id;

  -- Credit requester
  UPDATE public.wallets
  SET balance = balance + v_request.amount,
      updated_at = NOW()
  WHERE id = v_requester_wallet.id;

  -- ============================================================================
  -- 8. Insert immutable transaction record (type = REQUEST)
  -- ============================================================================
  INSERT INTO public.transactions (
    transaction_reference,
    sender_id,
    receiver_id,
    amount,
    fee,
    currency,
    type,
    status,
    category,
    note,
    idempotency_key,
    settled_at
  ) VALUES (
    p_tx_reference,
    p_payer_id,                    -- payer is the "sender" in this financial flow
    v_request.requester_id,        -- requester is the "receiver"
    v_request.amount,
    0.00,                          -- Payment requests carry no platform fee
    v_request.currency,
    'REQUEST',
    'COMPLETED',
    v_request.category,
    v_request.note,
    p_idempotency_key,
    NOW()
  )
  RETURNING id INTO v_transaction_id;

  -- ============================================================================
  -- 9. Insert balanced double-entry ledger entries
  -- ============================================================================
  -- DEBIT payer wallet for request amount
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, direction, amount)
  VALUES (v_transaction_id, v_payer_wallet.id, 'DEBIT', v_request.amount);

  -- CREDIT requester wallet for request amount
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, direction, amount)
  VALUES (v_transaction_id, v_requester_wallet.id, 'CREDIT', v_request.amount);

  -- ============================================================================
  -- 10. Mark the payment request as COMPLETED and link transaction
  -- ============================================================================
  UPDATE public.payment_requests
  SET status = 'COMPLETED',
      transaction_id = v_transaction_id,
      updated_at = NOW()
  WHERE id = p_request_id;

  -- ============================================================================
  -- 11. Build and return settlement receipt as JSONB
  -- ============================================================================
  v_result := jsonb_build_object(
    'requestId',          p_request_id::TEXT,
    'transactionId',      v_transaction_id::TEXT,
    'transactionReference', p_tx_reference,
    'payerId',            p_payer_id::TEXT,
    'requesterId',        v_request.requester_id::TEXT,
    'amount',             v_request.amount,
    'currency',           v_request.currency,
    'status',             'COMPLETED',
    'category',           v_request.category,
    'note',               v_request.note,
    'payerBalanceAfter',  (v_payer_wallet.balance - v_request.amount),
    'settledAt',          NOW()::TEXT
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    -- All changes rolled back implicitly
    RAISE;
END;
$$;

-- ============================================================================
-- Security & Privileges
-- ============================================================================
REVOKE ALL ON FUNCTION public.settle_payment_request_atomic(UUID, UUID, UUID, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.settle_payment_request_atomic(UUID, UUID, UUID, VARCHAR) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_payment_request_atomic(UUID, UUID, UUID, VARCHAR) TO service_role;

COMMENT ON FUNCTION public.settle_payment_request_atomic(UUID, UUID, UUID, VARCHAR) IS
  'Atomically settles a payment request: debit payer, credit requester, create transaction + balanced ledger entries, mark request COMPLETED. SECURITY DEFINER, service_role only.';
