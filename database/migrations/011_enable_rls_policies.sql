-- ============================================================================
-- Migration 011: Enable Row Level Security (RLS) and Create Policies
-- B-Wallet FinTech Database Schema
-- ============================================================================
-- Enables RLS on all public tables and creates foundational security
-- policies that:
-- 1. Allow users to read only their own data
-- 2. Block ALL direct client mutations on financial tables
--    (wallets, transactions, ledger_entries)
-- 3. Allow specific safe mutations where appropriate
--    (profiles: UPDATE own; saved_cards: DELETE own; notifications: UPDATE own)
--
-- Financial tables are ONLY writable via service_role (Node.js backend).
-- ============================================================================

-- ============================================================================
-- PROFILES: Users can SELECT and UPDATE their own profile
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ============================================================================
-- WALLETS: Users can SELECT their own wallet. NO direct mutations allowed.
-- Balance changes ONLY happen via server-side atomic procedures.
-- ============================================================================

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallets_select_own"
  ON public.wallets
  FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT, UPDATE, or DELETE policies for wallets.
-- Only service_role can modify wallet data.

-- ============================================================================
-- TRANSACTIONS: Users can view transactions they sent or received.
-- NO direct client mutations allowed. Immutable append-only design.
-- ============================================================================

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transactions_select_own"
  ON public.transactions
  FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- No INSERT, UPDATE, or DELETE policies for transactions.
-- Only service_role can write transaction records.

-- ============================================================================
-- LEDGER ENTRIES: Users can view ledger entries linked to their wallet.
-- NO direct client mutations allowed.
-- ============================================================================

ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ledger_entries_select_own"
  ON public.ledger_entries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.wallets
      WHERE wallets.id = ledger_entries.wallet_id
        AND wallets.user_id = auth.uid()
    )
  );

-- No INSERT, UPDATE, or DELETE policies for ledger_entries.
-- Only service_role can write ledger entries.

-- ============================================================================
-- SAVED CARDS: Users can SELECT and DELETE their own cards.
-- INSERT is only via service_role (after gateway tokenization).
-- ============================================================================

ALTER TABLE public.saved_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_cards_select_own"
  ON public.saved_cards
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "saved_cards_delete_own"
  ON public.saved_cards
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- CONVERSATIONS: Users can view conversations they participate in.
-- ============================================================================

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversations_select_own"
  ON public.conversations
  FOR SELECT
  USING (auth.uid() = participant_one OR auth.uid() = participant_two);

-- ============================================================================
-- MESSAGES: Users can read messages in their conversations and send messages.
-- ============================================================================

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_select_own"
  ON public.messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations
      WHERE conversations.id = messages.conversation_id
        AND (conversations.participant_one = auth.uid()
             OR conversations.participant_two = auth.uid())
    )
  );

CREATE POLICY "messages_insert_own"
  ON public.messages
  FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.conversations
      WHERE conversations.id = conversation_id
        AND (conversations.participant_one = auth.uid()
             OR conversations.participant_two = auth.uid())
    )
  );

-- ============================================================================
-- NOTIFICATIONS: Users can SELECT and UPDATE (mark as read) their own.
-- ============================================================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own"
  ON public.notifications
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "notifications_update_own"
  ON public.notifications
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- PAYMENT REQUESTS: Users can view requests where they are requester or payer.
-- ============================================================================

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_requests_select_own"
  ON public.payment_requests
  FOR SELECT
  USING (auth.uid() = requester_id OR auth.uid() = payer_id);

-- ============================================================================
-- IDEMPOTENCY KEYS: Users can view their own idempotency keys.
-- All writes happen via service_role only.
-- ============================================================================

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "idempotency_keys_select_own"
  ON public.idempotency_keys
  FOR SELECT
  USING (auth.uid() = user_id);
