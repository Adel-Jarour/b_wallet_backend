-- ============================================================================
-- Migration 020: top_up_wallet_atomic PL/pgSQL Stored Procedure
-- B-Wallet FinTech Database Schema (Sprint 6)
-- ============================================================================
-- Atomically processes an external payment gateway top-up settlement:
--   1. Validates input amount > 0.
--   2. Idempotency check: returns existing receipt if idempotency_key or
--      transaction_reference has already been settled.
--   3. Deadlock-free row-level locking on user wallet and system settlement wallet.
--   4. Validates user wallet status is ACTIVE.
--   5. Credits user wallet balance; debits system settlement clearing account.
--   6. Inserts immutable transaction header (type = 'TOP_UP', status = 'COMPLETED').
--   7. Inserts balanced double-entry ledger records (CREDIT user, DEBIT settlement).
--   8. Returns structured JSONB receipt.
--
-- Security:
--   - SECURITY DEFINER + SET search_path = public, pg_temp
--   - REVOKE ALL FROM PUBLIC, anon, authenticated
--   - GRANT EXECUTE TO service_role
-- ============================================================================

CREATE OR REPLACE FUNCTION public.top_up_wallet_atomic(
  p_wallet_id       UUID,           -- Target user wallet ID
  p_amount          NUMERIC(15,2),  -- Top-up credit amount
  p_reference       VARCHAR(50),    -- Transaction reference (e.g. TXN-TOPUP-...)
  p_idempotency_key UUID DEFAULT NULL -- Client or webhook idempotency UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_wallet       RECORD;
  v_settlement_wallet RECORD;
  v_existing_tx       RECORD;
  v_transaction_id    UUID;
  v_balance_before    NUMERIC(15,2);
  v_balance_after     NUMERIC(15,2);
  v_result            JSONB;
BEGIN
  -- ============================================================================
  -- 1. Input Validation
  -- ============================================================================
  IF p_amount IS NULL OR p_amount <= 0.00 THEN
    RAISE EXCEPTION 'Top-up amount must be strictly positive (got %)', p_amount
      USING ERRCODE = 'P0001';
  END IF;

  -- ============================================================================
  -- 2. Idempotency check: Already processed transaction
  -- ============================================================================
  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.id, t.transaction_reference, t.amount, t.currency, t.settled_at, w.balance
    INTO v_existing_tx
    FROM public.transactions t
    JOIN public.wallets w ON (w.user_id = t.receiver_id AND w.currency = t.currency)
    WHERE t.idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_processed', true,
        'transaction_id', v_existing_tx.id,
        'transaction_reference', v_existing_tx.transaction_reference,
        'amount', v_existing_tx.amount,
        'currency', v_existing_tx.currency,
        'balance_after', v_existing_tx.balance,
        'settled_at', v_existing_tx.settled_at
      );
    END IF;
  END IF;

  -- Check by reference if reference already exists
  SELECT t.id, t.transaction_reference, t.amount, t.currency, t.settled_at, w.balance
  INTO v_existing_tx
  FROM public.transactions t
  JOIN public.wallets w ON (w.user_id = t.receiver_id AND w.currency = t.currency)
  WHERE t.transaction_reference = p_reference;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_processed', true,
      'transaction_id', v_existing_tx.id,
      'transaction_reference', v_existing_tx.transaction_reference,
      'amount', v_existing_tx.amount,
      'currency', v_existing_tx.currency,
      'balance_after', v_existing_tx.balance,
      'settled_at', v_existing_tx.settled_at
    );
  END IF;

  -- ============================================================================
  -- 3. Wallet Discovery (Pre-lock)
  -- ============================================================================
  SELECT id, user_id, balance, status, currency
  INTO v_user_wallet
  FROM public.wallets
  WHERE id = p_wallet_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target wallet with ID % not found', p_wallet_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT id, user_id, balance, status, currency
  INTO v_settlement_wallet
  FROM public.wallets
  WHERE wallet_type = 'SYSTEM_SETTLEMENT' AND currency = v_user_wallet.currency;

  IF NOT FOUND THEN
    -- Fallback to default USD system settlement wallet if currency-specific not found
    SELECT id, user_id, balance, status, currency
    INTO v_settlement_wallet
    FROM public.wallets
    WHERE id = '00000000-0000-0000-0000-000000000002'::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'System settlement wallet not found for currency %', v_user_wallet.currency
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- ============================================================================
  -- 4. Deterministic Row-Level Locking (Deadlock Prevention)
  -- ============================================================================
  PERFORM 1 FROM public.wallets
  WHERE id IN (v_user_wallet.id, v_settlement_wallet.id)
  ORDER BY id
  FOR UPDATE;

  -- Re-read user wallet after lock
  SELECT id, user_id, balance, status, currency
  INTO v_user_wallet
  FROM public.wallets
  WHERE id = p_wallet_id;

  IF v_user_wallet.status != 'ACTIVE' THEN
    RAISE EXCEPTION 'Target wallet is not ACTIVE (status: %)', v_user_wallet.status
      USING ERRCODE = 'P0003';
  END IF;

  v_balance_before := v_user_wallet.balance;
  v_balance_after := v_balance_before + p_amount;

  -- ============================================================================
  -- 5. Balance Updates
  -- ============================================================================
  -- Credit user wallet
  UPDATE public.wallets
  SET balance = balance + p_amount,
      updated_at = NOW()
  WHERE id = v_user_wallet.id;

  -- Debit system settlement clearing account
  UPDATE public.wallets
  SET balance = balance - p_amount,
      updated_at = NOW()
  WHERE id = v_settlement_wallet.id;

  -- ============================================================================
  -- 6. Insert Transaction Record
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
    p_reference,
    NULL,
    v_user_wallet.user_id,
    p_amount,
    0.00,
    v_user_wallet.currency,
    'TOP_UP',
    'COMPLETED',
    'TopUp',
    'Wallet Top-Up via Payment Gateway',
    p_idempotency_key,
    NOW()
  )
  RETURNING id INTO v_transaction_id;

  -- ============================================================================
  -- 7. Balanced Double-Entry Ledger Entries
  -- ============================================================================
  -- 7a. CREDIT user wallet
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, direction, amount)
  VALUES (v_transaction_id, v_user_wallet.id, 'CREDIT', p_amount);

  -- 7b. DEBIT system settlement wallet (symmetrical double entry)
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, direction, amount)
  VALUES (v_transaction_id, v_settlement_wallet.id, 'DEBIT', p_amount);

  -- ============================================================================
  -- 8. Return Receipt
  -- ============================================================================
  v_result := jsonb_build_object(
    'success', true,
    'already_processed', false,
    'transaction_id', v_transaction_id,
    'transaction_reference', p_reference,
    'wallet_id', v_user_wallet.id,
    'user_id', v_user_wallet.user_id,
    'amount', p_amount,
    'currency', v_user_wallet.currency,
    'balance_before', v_balance_before,
    'balance_after', v_balance_after,
    'settled_at', NOW()
  );

  RETURN v_result;
END;
$$;

-- Security & Permissions
REVOKE ALL ON FUNCTION public.top_up_wallet_atomic(UUID, NUMERIC, VARCHAR, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.top_up_wallet_atomic(UUID, NUMERIC, VARCHAR, UUID) TO service_role;

COMMENT ON FUNCTION public.top_up_wallet_atomic IS
  'Atomically credits user wallet, debits system settlement clearing wallet, inserts TOP_UP transaction and symmetrical double-entry ledger records.';
