-- ============================================================================
-- Migration 015: transfer_funds_atomic PL/pgSQL Stored Procedure
-- B-Wallet FinTech Database Schema (Sprint 4 - Hardened)
-- ============================================================================
-- Executes an atomic P2P wallet transfer with row-level locking and strict
-- double-entry ledger fee accounting.
--
-- Security Hardening:
--   - SECURITY DEFINER: runs with owner privileges.
--   - SET search_path = public, pg_temp to eliminate search_path hijacking.
--   - Boundary Authorization: If invoked in an authenticated context (auth.uid()),
--     verifies auth.uid() == p_sender_id to prevent caller impersonation.
--   - Explicit Permissions:
--       REVOKE ALL FROM PUBLIC, anon, authenticated;
--       GRANT EXECUTE TO service_role;
--
-- Double-Entry Ledger Fee Accounting:
--   - When fee = 0.00:
--       Sender DEBIT = p_amount
--       Receiver CREDIT = p_amount
--       Total Debits ($X) == Total Credits ($X)
--   - When fee > 0.00:
--       Sender DEBIT = p_amount + p_fee
--       Receiver CREDIT = p_amount
--       System Fee Wallet CREDIT = p_fee
--       Total Debits ($X + $F) == Total Credits ($X + $F)
--       The ledger is ALWAYS balanced.
--
-- Concurrency & Deadlock Prevention:
--   - All affected wallets (sender, receiver, and fee wallet if fee > 0)
--     are locked simultaneously in a single deterministic query:
--     SELECT ... WHERE id IN (...) ORDER BY id FOR UPDATE.
--   - Eliminates circular wait conditions completely.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.transfer_funds_atomic(
  p_sender_id         UUID,           -- Verified sender user ID (from JWT)
  p_receiver_id       UUID,           -- Resolved receiver user ID
  p_amount            NUMERIC(15,2),  -- Transfer amount (must be > 0)
  p_fee               NUMERIC(15,2),  -- Platform fee (>= 0.00)
  p_currency          CHAR(3),        -- Currency code (e.g. 'USD')
  p_category          VARCHAR(50),    -- Transaction category
  p_note              TEXT,           -- Optional user note
  p_idempotency_key   UUID,           -- Client UUIDv4 for deduplication
  p_tx_reference      VARCHAR(50)     -- Unique transaction reference (pre-generated)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender_wallet     RECORD;
  v_receiver_wallet   RECORD;
  v_fee_wallet        RECORD;
  v_total_debit       NUMERIC(15,2);
  v_fee_balance_after NUMERIC(15,2) := NULL;
  v_transaction_id    UUID;
  v_result            JSONB;
  v_caller_uid        UUID;
BEGIN
  -- ============================================================================
  -- 0. Boundary Authorization: Prevent caller impersonation
  -- ============================================================================
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NOT NULL AND v_caller_uid != p_sender_id THEN
    RAISE EXCEPTION 'Authorization violation: caller auth.uid (%) does not match sender (%)',
      v_caller_uid, p_sender_id
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  -- ============================================================================
  -- 1. Input validation
  -- ============================================================================
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be positive (got %)', p_amount
      USING ERRCODE = 'P0001';
  END IF;

  IF p_fee IS NULL OR p_fee < 0 THEN
    RAISE EXCEPTION 'Transfer fee cannot be negative (got %)', p_fee
      USING ERRCODE = 'P0001';
  END IF;

  IF p_sender_id = p_receiver_id THEN
    RAISE EXCEPTION 'Sender and receiver cannot be the same user'
      USING ERRCODE = 'P0001';
  END IF;

  v_total_debit := p_amount + p_fee;

  -- ============================================================================
  -- 2. Wallet discovery (pre-lock)
  -- ============================================================================
  SELECT id, user_id, balance, status, currency INTO v_sender_wallet
  FROM public.wallets
  WHERE user_id = p_sender_id AND currency = p_currency;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sender wallet not found for currency %', p_currency
      USING ERRCODE = 'P0002';
  END IF;

  SELECT id, user_id, balance, status, currency INTO v_receiver_wallet
  FROM public.wallets
  WHERE user_id = p_receiver_id AND currency = p_currency;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receiver wallet not found for currency %', p_currency
      USING ERRCODE = 'P0002';
  END IF;

  IF p_fee > 0 THEN
    SELECT id, user_id, balance, status, currency INTO v_fee_wallet
    FROM public.wallets
    WHERE wallet_type = 'SYSTEM_FEE' AND currency = p_currency;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'System fee wallet not found for currency %', p_currency
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- ============================================================================
  -- 3. Deterministic Row-Level Locking (Deadlock Prevention)
  --    Locks all affected wallets in strict ascending order of UUIDs
  -- ============================================================================
  IF p_fee > 0 THEN
    PERFORM 1 FROM public.wallets
    WHERE id IN (v_sender_wallet.id, v_receiver_wallet.id, v_fee_wallet.id)
    ORDER BY id
    FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.wallets
    WHERE id IN (v_sender_wallet.id, v_receiver_wallet.id)
    ORDER BY id
    FOR UPDATE;
  END IF;

  -- Re-read locked rows with post-lock state
  SELECT * INTO v_sender_wallet FROM public.wallets WHERE id = v_sender_wallet.id;
  SELECT * INTO v_receiver_wallet FROM public.wallets WHERE id = v_receiver_wallet.id;
  IF p_fee > 0 THEN
    SELECT * INTO v_fee_wallet FROM public.wallets WHERE id = v_fee_wallet.id;
  END IF;

  -- ============================================================================
  -- 4. Validate wallet ownership and active status
  -- ============================================================================
  IF v_sender_wallet.user_id != p_sender_id THEN
    RAISE EXCEPTION 'Sender wallet ownership mismatch: security violation'
      USING ERRCODE = 'P0003';
  END IF;

  IF v_receiver_wallet.user_id != p_receiver_id THEN
    RAISE EXCEPTION 'Receiver wallet ownership mismatch: security violation'
      USING ERRCODE = 'P0003';
  END IF;

  IF v_sender_wallet.status != 'ACTIVE' THEN
    RAISE EXCEPTION 'Sender wallet is not ACTIVE (status: %)', v_sender_wallet.status
      USING ERRCODE = 'P0004';
  END IF;

  IF v_receiver_wallet.status != 'ACTIVE' THEN
    RAISE EXCEPTION 'Receiver wallet is not ACTIVE (status: %)', v_receiver_wallet.status
      USING ERRCODE = 'P0004';
  END IF;

  IF p_fee > 0 THEN
    IF v_fee_wallet.status != 'ACTIVE' THEN
      RAISE EXCEPTION 'System fee wallet is not ACTIVE (status: %)', v_fee_wallet.status
        USING ERRCODE = 'P0004';
    END IF;
  END IF;

  -- ============================================================================
  -- 5. Validate sender has sufficient funds (Amount + Fee)
  -- ============================================================================
  IF v_sender_wallet.balance < v_total_debit THEN
    RAISE EXCEPTION 'Insufficient funds: balance % < required %',
      v_sender_wallet.balance, v_total_debit
      USING ERRCODE = 'P0005';
  END IF;

  -- ============================================================================
  -- 6. Execute balance updates
  -- ============================================================================
  -- Debit sender wallet (Amount + Fee)
  UPDATE public.wallets
  SET balance = balance - v_total_debit,
      updated_at = NOW()
  WHERE id = v_sender_wallet.id;

  -- Credit receiver wallet (Amount)
  UPDATE public.wallets
  SET balance = balance + p_amount,
      updated_at = NOW()
  WHERE id = v_receiver_wallet.id;

  -- Credit system fee wallet (Fee) if fee > 0
  IF p_fee > 0 THEN
    UPDATE public.wallets
    SET balance = balance + p_fee,
        updated_at = NOW()
    WHERE id = v_fee_wallet.id;
    v_fee_balance_after := (v_fee_wallet.balance + p_fee);
  END IF;

  -- ============================================================================
  -- 7. Insert immutable transaction record
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
    p_sender_id,
    p_receiver_id,
    p_amount,
    p_fee,
    p_currency,
    'TRANSFER',
    'COMPLETED',
    p_category,
    p_note,
    p_idempotency_key,
    NOW()
  )
  RETURNING id INTO v_transaction_id;

  -- ============================================================================
  -- 8. Insert balanced double-entry ledger entries
  --    Total Debits strictly equals Total Credits in all scenarios
  -- ============================================================================
  -- 8a. DEBIT sender for total deduction (amount + fee)
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, direction, amount)
  VALUES (v_transaction_id, v_sender_wallet.id, 'DEBIT', v_total_debit);

  -- 8b. CREDIT receiver for transfer amount
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, direction, amount)
  VALUES (v_transaction_id, v_receiver_wallet.id, 'CREDIT', p_amount);

  -- 8c. CREDIT fee wallet for platform fee (if fee > 0)
  IF p_fee > 0 THEN
    INSERT INTO public.ledger_entries (transaction_id, wallet_id, direction, amount)
    VALUES (v_transaction_id, v_fee_wallet.id, 'CREDIT', p_fee);
  END IF;

  -- ============================================================================
  -- 9. Build and return transfer receipt as JSONB
  -- ============================================================================
  v_result := jsonb_build_object(
    'transactionId', v_transaction_id::TEXT,
    'transactionReference', p_tx_reference,
    'senderId', p_sender_id::TEXT,
    'receiverId', p_receiver_id::TEXT,
    'amount', p_amount,
    'fee', p_fee,
    'currency', p_currency,
    'status', 'COMPLETED',
    'category', p_category,
    'note', p_note,
    'senderBalanceAfter', (v_sender_wallet.balance - v_total_debit),
    'receiverBalanceAfter', (v_receiver_wallet.balance + p_amount),
    'feeWalletBalanceAfter', v_fee_balance_after,
    'settledAt', NOW()::TEXT
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    -- Automatic implicit rollback of all updates, inserts, and locks
    RAISE;
END;
$$;

-- ============================================================================
-- Security & Privileges: Block direct client access, grant strictly to service_role
-- ============================================================================
REVOKE ALL ON FUNCTION public.transfer_funds_atomic(UUID, UUID, NUMERIC, NUMERIC, CHAR, VARCHAR, TEXT, UUID, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transfer_funds_atomic(UUID, UUID, NUMERIC, NUMERIC, CHAR, VARCHAR, TEXT, UUID, VARCHAR) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_funds_atomic(UUID, UUID, NUMERIC, NUMERIC, CHAR, VARCHAR, TEXT, UUID, VARCHAR) TO service_role;

COMMENT ON FUNCTION public.transfer_funds_atomic(UUID, UUID, NUMERIC, NUMERIC, CHAR, VARCHAR, TEXT, UUID, VARCHAR) IS
  'Hardened atomic P2P fund transfer with deterministic row-level locking, balanced double-entry fee accounting, and service_role execute privileges.';
